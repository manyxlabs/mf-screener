"""Benchmark CSV validation, mapping, coverage warnings and the currency guard.

The currency tests are the point of this file. A USD index compared against a rupee
NAV produces an alpha, a beta and a tracking error that are mostly exchange rate, and
nothing about the resulting number looks wrong, so the guard is asserted at every
layer it exists in: the import contract, the mapping, and the computed snapshot.
"""

from __future__ import annotations

from pathlib import Path
from typing import ClassVar

import numpy as np
import pandas as pd
import pytest

from mf_analytics.config import BASE_CURRENCY, Settings
from mf_analytics.db import connect, init_schema
from mf_analytics.ingest.benchmark_csv import BenchmarkCsvError
from mf_analytics.ingest.benchmarks import (
    apply_mapping,
    build_index_fund_proxy,
    coverage_report,
    import_csv,
    validate_csv,
)
from mf_analytics.pipeline import load_benchmarks
from mf_analytics.quality import Reason

HEADER = "date,benchmark_id,benchmark_name,currency,total_return_index\n"


def write_csv(tmp_path: Path, name: str, body: str, header: str = HEADER) -> Path:
    path = tmp_path / name
    path.write_text(header + body)
    return path


def valid_body(bid: str = "NIFTY50_TRI", currency: str = "INR", months: int = 40) -> str:
    dates = pd.date_range("2020-01-31", periods=months, freq="ME")
    levels = 10_000.0 * (1.01 ** np.arange(months))
    return "".join(
        f"{d.date()},{bid},{bid} Index,{currency},{level:.2f}\n"
        for d, level in zip(dates, levels, strict=True)
    )


@pytest.fixture
def settings(tmp_path: Path) -> Settings:
    s = Settings(mf_data_dir=tmp_path / "data", mf_duckdb_path=tmp_path / "data" / "t.duckdb")
    s.ensure_dirs()
    with connect(s) as con:
        init_schema(con)
    return s


# --------------------------------------------------------------------------- contract


def test_a_file_without_a_currency_column_is_refused(tmp_path: Path) -> None:
    """The single most dangerous default there is.

    A downloaded S&P 500 file has no currency column. Assuming INR would store a USD
    series as rupees, and every benchmark-relative metric downstream would silently
    become an FX measurement with no way left to detect it.
    """
    path = write_csv(
        tmp_path,
        "sp500.csv",
        "2024-01-31,SP500,S&P 500,10000\n2024-02-29,SP500,S&P 500,10200\n",
        header="date,benchmark_id,benchmark_name,total_return_index\n",
    )
    with pytest.raises(BenchmarkCsvError, match="currency"):
        validate_csv(path)


def test_every_problem_is_reported_in_one_pass(tmp_path: Path) -> None:
    """A hand-built file should be fixable in one edit, not one error per run."""
    path = write_csv(
        tmp_path,
        "bad.csv",
        "2024-01-31,X,X Index,INR,100\n"
        "2024-01-31,X,X Index,INR,105\n"
        "not-a-date,X,X Index,INR,110\n"
        "2024-02-29,X,X Index,USD,-5\n",
    )
    with pytest.raises(BenchmarkCsvError) as excinfo:
        validate_csv(path)
    message = str(excinfo.value)
    assert "unparseable date" in message
    assert "non-positive" in message
    assert "more than one currency" in message
    assert "duplicate" in message


def test_a_bad_date_names_its_csv_line(tmp_path: Path) -> None:
    path = write_csv(tmp_path, "d.csv", "2024-01-31,X,X,INR,100\nnope,X,X,INR,110\n")
    with pytest.raises(BenchmarkCsvError, match="CSV line 3"):
        validate_csv(path)


@pytest.mark.parametrize("level", ["0", "-1", "abc"])
def test_a_non_positive_level_is_refused(tmp_path: Path, level: str) -> None:
    """Compounding through a zero or negative level manufactures a -100% month."""
    path = write_csv(tmp_path, "z.csv", f"2024-01-31,X,X,INR,100\n2024-02-29,X,X,INR,{level}\n")
    with pytest.raises(BenchmarkCsvError, match="non-positive"):
        validate_csv(path)


def test_a_single_row_series_is_refused(tmp_path: Path) -> None:
    path = write_csv(tmp_path, "one.csv", "2024-01-31,X,X,INR,100\n")
    with pytest.raises(BenchmarkCsvError, match="at least two"):
        validate_csv(path)


def test_a_currency_that_is_not_an_iso_code_is_refused(tmp_path: Path) -> None:
    path = write_csv(tmp_path, "c.csv", "2024-01-31,X,X,Rupees,100\n2024-02-29,X,X,Rupees,101\n")
    with pytest.raises(BenchmarkCsvError, match="3-letter ISO code"):
        validate_csv(path)


def test_nothing_is_written_when_the_file_is_refused(tmp_path: Path, settings: Settings) -> None:
    """A partial import is worse than none: the gap is invisible once rows are in."""
    good = write_csv(tmp_path, "good.csv", valid_body())
    import_csv(good, settings)
    bad = write_csv(tmp_path, "bad.csv", valid_body(months=3) + "2020-04-30,NIFTY50_TRI,N,INR,-1\n")
    with pytest.raises(BenchmarkCsvError):
        import_csv(bad, settings)
    with connect(settings) as con:
        assert con.execute("SELECT count(*) FROM benchmarks").fetchone() == (40,)


def test_a_valid_file_imports_and_reports_what_it_loaded(
    tmp_path: Path, settings: Settings
) -> None:
    info = import_csv(write_csv(tmp_path, "n.csv", valid_body()), settings)
    assert info["rows"] == 40
    assert info["warnings"] == []
    assert info["series"][0]["currency"] == BASE_CURRENCY
    assert info["series"][0]["comparable_with_inr_funds"] is True


def test_a_foreign_currency_import_warns_without_failing(
    tmp_path: Path, settings: Settings
) -> None:
    """The file is valid, so it loads. What it cannot be used for is said out loud."""
    info = import_csv(write_csv(tmp_path, "s.csv", valid_body("SP500_TR_USD", "USD")), settings)
    assert info["series"][0]["comparable_with_inr_funds"] is False
    assert any("USD" in w and "withheld" in w for w in info["warnings"])


def test_a_short_series_warns_that_no_risk_metric_can_use_it(
    tmp_path: Path, settings: Settings
) -> None:
    info = import_csv(write_csv(tmp_path, "t.csv", valid_body(months=6)), settings)
    assert any("month-end observations" in w for w in info["warnings"])


def test_a_price_index_is_accepted_with_a_note(tmp_path: Path, settings: Settings) -> None:
    body = "2024-01-31,X,X Index,INR,100,90\n2024-02-29,X,X Index,INR,101,91\n"
    path = write_csv(
        tmp_path,
        "p.csv",
        body,
        header="date,benchmark_id,benchmark_name,currency,total_return_index,price\n",
    )
    info = validate_csv(path)
    assert info["value_column"] == "total_return_index"
    assert any("total-return" in w for w in info["warnings"])


# --------------------------------------------------------------------------- mapping


def _master(settings: Settings, rows: list[tuple[str, str, str]]) -> None:
    frame = pd.DataFrame(rows, columns=["scheme_code", "scheme_name", "clean_sub_category"])
    with connect(settings) as con:
        init_schema(con)
        con.register("m", frame)
        con.execute(
            "INSERT INTO scheme_master (scheme_code, scheme_name, clean_sub_category, source, "
            "ingested_at) SELECT scheme_code, scheme_name, clean_sub_category, 'test', now() FROM m"
        )
        con.unregister("m")


def test_mapping_prefers_an_inr_series_over_a_foreign_one(
    tmp_path: Path, settings: Settings
) -> None:
    """The yaml lists SP500_TR_INR first and SP500_TR_USD as a fallback, but the rule
    holds regardless of order: a foreign series yields no metrics at all."""
    _master(settings, [("1", "Motilal S&P 500 Index Fund - Direct - Growth", "Index Funds")])
    import_csv(write_csv(tmp_path, "u.csv", valid_body("SP500_TR_USD", "USD")), settings)
    import_csv(write_csv(tmp_path, "i.csv", valid_body("SP500_TR_INR", "INR")), settings)
    info = apply_mapping(settings)
    assert info["currency_mismatched_schemes"] == 0
    with connect(settings) as con:
        chosen = con.execute("SELECT benchmark_id FROM scheme_benchmark_map").fetchone()
    assert chosen is not None and chosen[0] == "SP500_TR_INR"


def test_mapping_to_a_foreign_series_is_labelled_a_currency_mismatch(
    tmp_path: Path, settings: Settings
) -> None:
    _master(settings, [("1", "Motilal S&P 500 Index Fund - Direct - Growth", "Index Funds")])
    import_csv(write_csv(tmp_path, "u.csv", valid_body("SP500_TR_USD", "USD")), settings)
    info = apply_mapping(settings)
    assert info["currency_mismatched_schemes"] == 1
    with connect(settings) as con:
        row = con.execute("SELECT benchmark_id, confidence FROM scheme_benchmark_map").fetchone()
    assert row == ("SP500_TR_USD", "currency_mismatch")


def test_coverage_warns_about_foreign_series_proxies_and_unmapped_schemes(
    tmp_path: Path, settings: Settings
) -> None:
    _master(
        settings,
        [
            ("1", "Motilal S&P 500 Index Fund - Direct - Growth", "Index Funds"),
            ("2", "Some Debt Fund - Direct - Growth", "Corporate Bond Fund"),
        ],
    )
    import_csv(write_csv(tmp_path, "u.csv", valid_body("SP500_TR_USD", "USD")), settings)
    apply_mapping(settings)
    with connect(settings) as con:
        report = coverage_report(lambda sql: con.execute(sql).fetch_df())
    assert report["schemes_unmapped"] == 1
    assert any("exchange rate" in w for w in report["warnings"])
    assert any("no benchmark mapped" in w for w in report["warnings"])
    assert report["benchmarks"][0]["comparable_with_inr_funds"] is False


def test_a_proxy_is_always_in_rupees_and_says_so(settings: Settings) -> None:
    """A feeder fund tracking a US index still files its NAV in rupees, having already
    absorbed the exchange rate. There is deliberately no way to label a proxy otherwise."""
    dates = pd.date_range("2020-01-31", periods=30, freq="ME")
    nav = pd.DataFrame(
        {
            "scheme_code": "1",
            "date": dates.date,
            "nav": 100.0 * (1.01 ** np.arange(30)),
            "source": "test",
            "ingested_at": pd.Timestamp("2026-01-01"),
            "year": dates.year,
        }
    )
    with connect(settings) as con:
        init_schema(con)
        con.register("n", nav)
        con.execute("CREATE OR REPLACE TABLE nav_daily AS SELECT * FROM n")
        con.unregister("n")
    info = build_index_fund_proxy("1", "SP500_PROXY", "S&P 500 feeder proxy", settings=settings)
    assert info["rows"] == 30
    with connect(settings) as con:
        currencies = con.execute("SELECT DISTINCT currency FROM benchmarks").fetchall()
    assert currencies == [(BASE_CURRENCY,)]


def test_a_table_holding_two_currencies_for_one_id_is_refused_at_load(
    settings: Settings,
) -> None:
    """The importer cannot produce this. Something else writing the table could, and a
    guess at that point is how FX noise becomes alpha, so the load fails loudly."""
    rows = pd.DataFrame(
        {
            "benchmark_id": "X",
            "benchmark_name": "X",
            "asset_class": "Equity",
            "currency": ["INR", "USD"],
            "source": "hand-written",
            "date": [pd.Timestamp("2024-01-31").date(), pd.Timestamp("2024-02-29").date()],
            "price_or_total_return_index": [100.0, 101.0],
            "monthly_return": [None, 0.01],
        }
    )
    with connect(settings) as con:
        init_schema(con)
        con.register("r", rows)
        con.execute("INSERT INTO benchmarks SELECT * FROM r")
        con.unregister("r")
        with pytest.raises(RuntimeError, match="more than one currency"):
            load_benchmarks(con)


# ------------------------------------------------------------------- end to end guard


def _build_lake(settings: Settings, currency: str) -> pd.DataFrame:
    """The synthetic dataset, with its benchmark labelled in `currency`."""
    from . import fixtures_data

    fixtures_data.build(settings)
    with connect(settings) as con:
        con.execute("UPDATE benchmarks SET currency = ?", [currency])
    from mf_analytics.pipeline import run as run_metrics

    run_metrics(settings)
    with connect(settings) as con:
        return con.execute(
            "SELECT * FROM scheme_metrics_snapshot WHERE scheme_code = 'S01'"
        ).fetch_df()


BENCHMARK_METRICS = (
    "alpha_5y",
    "beta_5y",
    "tracking_error_5y",
    "r_squared_5y",
    "information_ratio_vs_benchmark_5y",
    "benchmark_return_5y",
    "fund_minus_benchmark_5y",
)


def test_an_inr_benchmark_produces_the_full_set_of_relative_metrics(tmp_path: Path) -> None:
    """The control. Without this, the USD test below could pass because the pipeline
    computes nothing at all rather than because the guard fired."""
    s = Settings(mf_data_dir=tmp_path / "d", mf_duckdb_path=tmp_path / "d" / "t.duckdb")
    row = _build_lake(s, BASE_CURRENCY).iloc[0]
    for name in BENCHMARK_METRICS:
        assert pd.notna(row[name]), f"{name} should be computed against an INR benchmark"
    assert "benchmark_currency_mismatch" not in row["data_quality_flags"]


def test_a_usd_benchmark_withholds_every_benchmark_relative_metric(tmp_path: Path) -> None:
    """Identical NAVs and an identical index, relabelled USD.

    Nothing about the numbers changes, which is exactly why this has to be enforced
    rather than noticed: the alpha and beta would look entirely plausible.
    """
    import json

    s = Settings(mf_data_dir=tmp_path / "d", mf_duckdb_path=tmp_path / "d" / "t.duckdb")
    row = _build_lake(s, "USD").iloc[0]

    for name in BENCHMARK_METRICS:
        assert pd.isna(row[name]), f"{name} must not be computed against a USD benchmark"
    reasons = json.loads(row["missing_reasons"])
    for name in BENCHMARK_METRICS:
        assert reasons[name] == Reason.BENCHMARK_CURRENCY, (
            f"{name} must say the currency is why, not that data is merely missing"
        )
    assert "benchmark_currency_mismatch" in json.loads(row["data_quality_flags"])

    # Peer-relative metrics are unaffected: they never touch the benchmark.
    assert pd.notna(row["information_ratio_vs_category_5y"])
    assert pd.notna(row["fund_minus_category_5y"])


def test_thousands_separators_are_accepted(tmp_path: Path) -> None:
    """Index providers publish "31,500.10"; rejecting it would send someone hunting for
    a corrupt row that is perfectly good data."""
    path = write_csv(
        tmp_path, "k.csv", '2024-01-31,X,X,INR,"31,500.10"\n2024-02-29,X,X,INR,"31,980.44"\n'
    )
    assert validate_csv(path)["series"][0]["rows"] == 2


class TestSectoralRuleMatching:
    """The AND predicate, and the two traps that make it necessary.

    A sector is named in the scheme name; whether the fund is an equity fund at all is
    only knowable from its sub-category. Matching on either alone is wrong in both
    directions, and both wrong directions exist in the real AMFI universe.
    """

    BANK_RULE: ClassVar[dict[str, object]] = {
        "match": "all",
        "sub_category_contains": ["Sectoral", "Thematic", "Index Fund", "Equity Funds"],
        "scheme_name_contains": ["nifty bank", "banking and financial", "financial services"],
        "scheme_name_excludes": ["debt", "liquid", "arbitrage", "crisil-ibx"],
        "benchmark_id": "NIFTY_BANK_PROXY",
    }

    def test_claims_a_real_banking_sector_fund(self):
        from mf_analytics.ingest.benchmarks import _rule_matches

        assert _rule_matches(
            self.BANK_RULE, "Sectoral/Thematic", "UTI Banking and Financial Services Fund - Growth"
        )

    def test_claims_a_bank_index_fund_filed_under_index_funds(self):
        from mf_analytics.ingest.benchmarks import _rule_matches

        assert _rule_matches(
            self.BANK_RULE, "Index Funds", "Axis Nifty Bank Index Fund - Direct Plan - Growth"
        )

    def test_does_not_claim_a_liquid_fund_from_an_amc_called_bank_of_india(self):
        """ "BANK OF INDIA" is a fund house, not a sector. A name-only rule would
        benchmark that house's liquid, arbitrage and ELSS funds against Nifty Bank."""
        from mf_analytics.ingest.benchmarks import _rule_matches

        for sub, name in [
            ("Liquid Fund", "BANK OF INDIA Liquid Fund- Regular Plan- Growth"),
            ("Arbitrage Fund", "BANK OF INDIA Arbitrage Fund Direct Plan Monthly IDCW"),
            ("Large & Mid Cap Fund", "BANK OF INDIA Large & Mid Cap Fund Direct Plan- Bonus"),
            ("ELSS", "BANK OF INDIA Mid Cap Tax Fund Series 1 Regular Plan Growth"),
        ]:
            assert not _rule_matches(self.BANK_RULE, sub, name), name

    def test_does_not_claim_a_debt_index_fund_that_names_financial_services(self):
        """SEBI files this under "Index Funds", so the equity gate admits it and only
        the exclusion list keeps a 3-6 month debt fund off an equity index."""
        from mf_analytics.ingest.benchmarks import _rule_matches

        assert not _rule_matches(
            self.BANK_RULE,
            "Index Funds",
            "Kotak CRISIL-IBX Financial Services 3-6 Months Debt Index Fund-Direct-Growth",
        )

    def test_does_not_claim_banking_and_psu_debt_funds(self):
        from mf_analytics.ingest.benchmarks import _rule_matches

        assert not _rule_matches(
            self.BANK_RULE, "Banking and PSU Debt Fund", "HDFC Banking and PSU Debt Fund - Growth"
        )

    def test_match_all_needs_both_lists_to_be_written(self):
        """An empty list must not make "all" pass on a condition nobody stated."""
        from mf_analytics.ingest.benchmarks import _rule_matches

        rule = {"match": "all", "sub_category_contains": ["Sectoral"], "benchmark_id": "X"}
        assert not _rule_matches(rule, "Sectoral/Thematic", "Anything")

    def test_the_default_is_still_or_so_existing_rules_are_unchanged(self):
        from mf_analytics.ingest.benchmarks import _rule_matches

        rule = {"sub_category_contains": ["Large Cap"], "benchmark_id": "NIFTY50_TRI"}
        assert _rule_matches(rule, "Large Cap Fund", "Anything At All")
