"""T3.3: the holdings import contract, and everything derived from it.

The contract tests are the point of this file. No holdings data ships and none is
fetched - the candidate source is unreachable and scraping AMC sites is refused - so
every row that ever reaches `scheme_holdings` comes through a file someone hands to
`make holdings-import`, and this contract is the only thing standing between a
mistyped spreadsheet and an overlap figure that is a hundred times too large while
still looking entirely plausible.
"""

from __future__ import annotations

import os
from datetime import date
from pathlib import Path

import httpx
import pandas as pd
import pytest

from mf_analytics.config import Settings, get_settings
from mf_analytics.enrich import REGISTRY, EnrichReason
from mf_analytics.enrich import holdings as holdings_enrich
from mf_analytics.enrich.holdings import (
    HoldingsReason,
    asset_type_split,
    concentration,
    equity_share,
    exposure_cross_check,
    fetch_scheme_holdings,
    overlap_pair,
    sector_allocation,
    turnover_series,
)
from mf_analytics.enrich.holdings_csv import HoldingsCsvError, read_and_validate, validate_frame
from mf_analytics.quality import all_reason_descriptions

HEADER = "scheme_code,as_of,instrument_id,instrument_name,weight,sector,asset_type\n"
KNOWN = {"S01", "S02", "S03"}


def check(body: str, header: str = HEADER, known: set[str] | None = KNOWN) -> tuple:
    """Run the contract over a CSV body held in memory, as a file would arrive."""
    import io

    raw = pd.read_csv(io.StringIO(header + body), dtype=str)
    return validate_frame(raw, Path("holdings.csv"), known)


def rejected(body: str, header: str = HEADER, known: set[str] | None = KNOWN) -> str:
    with pytest.raises(HoldingsCsvError) as exc:
        check(body, header, known)
    return str(exc.value)


GOOD_BODY = (
    "S01,2026-06-30,INE001,Alpha Ltd,0.40,Financials,equity\n"
    "S01,2026-06-30,INE002,Beta Ltd,0.35,Energy,equity\n"
    "S01,2026-06-30,INE003,Gamma Ltd,0.20,Technology,equity\n"
    "S01,2026-06-30,,Cash and equivalents,0.05,,cash\n"
)


# --------------------------------------------------------------------------- contract


def test_a_well_formed_file_passes_and_reports_each_scheme_month() -> None:
    out, report = check(GOOD_BODY)
    assert len(out) == 4
    assert out["as_of"].unique().tolist() == [date(2026, 6, 30)]
    assert report.scheme_months[0].to_dict() == {
        "scheme_code": "S01",
        "as_of": "2026-06-30",
        "holdings": 4,
        "weight_sum": 1.0,
        "top_10_concentration": 1.0,
    }
    # The cash line has no instrument_id, so it is matched by name and said so.
    assert any("no instrument_id" in w for w in report.warnings)


def test_a_missing_required_column_names_it() -> None:
    message = rejected(
        "S01,2026-06-30,INE001,0.4\n", header="scheme_code,as_of,instrument_id,weight\n"
    )
    assert "instrument_name" in message


def test_an_unparseable_as_of_is_rejected_with_its_line_number() -> None:
    message = rejected(
        "S01,2026-06-30,INE001,Alpha Ltd,0.6,Financials,equity\n"
        "S01,last quarter,INE002,Beta Ltd,0.4,Energy,equity\n"
    )
    assert "unparseable as_of" in message
    assert "line(s) 3" in message


def test_a_non_numeric_weight_is_rejected_with_its_line_number() -> None:
    message = rejected(
        "S01,2026-06-30,INE001,Alpha Ltd,0.6,Financials,equity\n"
        "S01,2026-06-30,INE002,Beta Ltd,4.5%,Energy,equity\n"
    )
    assert "non-numeric weight" in message
    assert "line(s) 3" in message


def test_a_negative_weight_is_rejected_with_its_line_number() -> None:
    message = rejected(
        "S01,2026-06-30,INE001,Alpha Ltd,0.6,Financials,equity\n"
        "S01,2026-06-30,INE002,Beta Ltd,-0.1,Energy,equity\n"
    )
    assert "negative weight" in message
    assert "line(s) 3" in message


def test_a_weight_above_one_says_weights_are_fractions_not_percentages() -> None:
    message = rejected(
        "S01,2026-06-30,INE001,Alpha Ltd,0.6,Financials,equity\n"
        "S01,2026-06-30,INE002,Beta Ltd,4.5,Energy,equity\n"
    )
    assert "fraction of net assets, not a percentage" in message
    assert "line(s) 3" in message


def test_a_percent_file_is_refused_with_the_correction_rather_than_converted() -> None:
    """The rule this contract exists for.

    Silently dividing by 100 would make a mistyped file import cleanly, and there would
    be nothing left in the data to say whether the operator meant percent or fractions
    the next time a file arrived that summed to 1.0 by coincidence.
    """
    body = (
        "S01,2026-06-30,INE001,Alpha Ltd,40,Financials,equity\n"
        "S01,2026-06-30,INE002,Beta Ltd,35,Energy,equity\n"
        "S01,2026-06-30,INE003,Gamma Ltd,25,Technology,equity\n"
    )
    message = rejected(body)
    assert "percent file" in message
    assert "divide this scheme-month's weights by 100" in message
    assert "line(s) 2, 3, 4" in message
    # Not also reported as three separate "weight above 1" problems.
    assert "fraction of net assets, not a percentage" not in message


def test_a_percent_file_stays_rejected_after_dividing_only_some_of_it() -> None:
    """A half-converted file is not a percent file, so it falls back to the plain
    above-one rejection rather than escaping both."""
    body = (
        "S01,2026-06-30,INE001,Alpha Ltd,0.40,Financials,equity\n"
        "S01,2026-06-30,INE002,Beta Ltd,35,Energy,equity\n"
    )
    message = rejected(body)
    assert "fraction of net assets, not a percentage" in message


def test_a_duplicate_instrument_in_one_scheme_month_is_rejected() -> None:
    message = rejected(
        "S01,2026-06-30,INE001,Alpha Ltd,0.5,Financials,equity\n"
        "S01,2026-06-30,INE001,Alpha Ltd,0.5,Financials,equity\n"
    )
    assert "duplicate (scheme_code, as_of, instrument)" in message
    assert "line(s) 2, 3" in message


def test_a_duplicate_is_caught_by_name_when_the_file_carries_no_id() -> None:
    message = rejected(
        "S01,2026-06-30,,Alpha Ltd,0.5,Financials,equity\n"
        "S01,2026-06-30,,Alpha Ltd,0.5,Financials,equity\n"
    )
    assert "duplicate" in message


def test_a_scheme_code_absent_from_scheme_master_is_rejected() -> None:
    message = rejected("S99,2026-06-30,INE001,Alpha Ltd,1.0,Financials,equity\n")
    assert "not in scheme_master" in message
    assert "S99" in message
    assert "line(s) 2" in message


def test_weights_summing_above_the_ceiling_are_rejected() -> None:
    message = rejected(
        "S01,2026-06-30,INE001,Alpha Ltd,0.60,Financials,equity\n"
        "S01,2026-06-30,INE002,Beta Ltd,0.55,Energy,equity\n"
    )
    assert "summing to 1.1500" in message
    assert "1.02 ceiling" in message


def test_rounding_slack_below_the_ceiling_is_accepted() -> None:
    out, _ = check(
        "S01,2026-06-30,INE001,Alpha Ltd,0.51,Financials,equity\n"
        "S01,2026-06-30,INE002,Beta Ltd,0.50,Energy,equity\n"
    )
    assert len(out) == 2


def test_an_unrecognised_asset_type_is_rejected() -> None:
    message = rejected("S01,2026-06-30,INE001,Alpha Ltd,1.0,Financials,Equity Shares\n")
    assert "asset_type outside" in message
    assert "line(s) 2" in message


def test_a_blank_instrument_name_is_rejected() -> None:
    message = rejected("S01,2026-06-30,INE001,,1.0,Financials,equity\n")
    assert "blank instrument_name" in message
    assert "line(s) 2" in message


def test_every_problem_is_reported_in_one_pass() -> None:
    """A hand-built file should be fixable in one edit, not one error per run."""
    message = rejected(
        "S01,not-a-date,INE001,Alpha Ltd,0.5,Financials,equity\n"
        "S01,2026-06-30,INE002,Beta Ltd,oops,Energy,equity\n"
        "S99,2026-06-30,INE003,Gamma Ltd,-0.2,Technology,equity\n"
    )
    for fragment in ("unparseable as_of", "non-numeric weight", "negative weight", "scheme_master"):
        assert fragment in message


def test_a_thin_scheme_month_warns_without_failing() -> None:
    _, report = check(
        "S01,2026-06-30,INE001,Alpha Ltd,0.50,Financials,equity\n"
        "S01,2026-06-30,INE002,Beta Ltd,0.30,Energy,equity\n"
    )
    assert any("below 0.9" in w for w in report.warnings)


def test_an_as_of_mid_month_collapses_to_that_month_end() -> None:
    out, _ = check("S01,2026-06-12,INE001,Alpha Ltd,1.0,Financials,equity\n")
    assert out["as_of"].iloc[0] == date(2026, 6, 30)


def test_a_file_with_only_a_header_is_rejected() -> None:
    assert "no rows" in rejected("")


def test_a_file_that_is_not_on_disk_at_all_is_reported_as_empty(tmp_path: Path) -> None:
    path = tmp_path / "empty.csv"
    path.write_text("")
    with pytest.raises(HoldingsCsvError, match="empty"):
        read_and_validate(path, KNOWN)


# --------------------------------------------------------------------------- derived


def portfolio(
    rows: list[tuple[str, float]], as_of: str = "2026-06-30", **extra: object
) -> pd.DataFrame:
    """A one-month portfolio in the shape the store hands back."""
    frame = pd.DataFrame(
        {
            "as_of": [date.fromisoformat(as_of)] * len(rows),
            "instrument_key": [key for key, _ in rows],
            "instrument_name": [key for key, _ in rows],
            "weight": [weight for _, weight in rows],
            "sector": [None] * len(rows),
            "asset_type": [None] * len(rows),
        }
    )
    for column, value in extra.items():
        frame[column] = value
    return frame


def test_two_identical_portfolios_overlap_completely() -> None:
    fund = portfolio([("X", 0.5), ("Y", 0.3), ("Z", 0.2)])
    assert overlap_pair("S01", fund, "S02", fund.copy()).overlap_pct == 100.0


def test_two_disjoint_portfolios_do_not_overlap_at_all() -> None:
    result = overlap_pair(
        "S01", portfolio([("X", 0.6), ("Y", 0.4)]), "S02", portfolio([("P", 0.7), ("Q", 0.3)])
    )
    assert result.overlap_pct == 0.0
    assert result.shared == []


def test_a_partial_overlap_is_the_sum_of_the_minimum_shared_weights() -> None:
    # X: min(0.40, 0.20) = 0.20; Y: min(0.30, 0.50) = 0.30; Z and W are not shared.
    result = overlap_pair(
        "S01",
        portfolio([("X", 0.40), ("Y", 0.30), ("Z", 0.30)]),
        "S02",
        portfolio([("X", 0.20), ("Y", 0.50), ("W", 0.30)]),
    )
    assert result.overlap_pct == 50.0
    assert [row["instrument_key"] for row in result.shared] == ["Y", "X"]
    assert result.shared[0] == {
        "instrument_key": "Y",
        "instrument_name": "Y",
        "weight_a": 0.3,
        "weight_b": 0.5,
        "min_weight": 0.3,
    }


def test_portfolios_more_than_a_month_apart_are_refused_rather_than_compared() -> None:
    result = overlap_pair(
        "S01",
        portfolio([("X", 1.0)], as_of="2026-01-31"),
        "S02",
        portfolio([("X", 1.0)], as_of="2026-06-30"),
    )
    assert result.overlap_pct is None
    assert result.reason == HoldingsReason.AS_OF_MISMATCH


def test_portfolios_one_month_apart_are_still_compared() -> None:
    result = overlap_pair(
        "S01",
        portfolio([("X", 1.0)], as_of="2026-05-31"),
        "S02",
        portfolio([("X", 1.0)], as_of="2026-06-30"),
    )
    assert result.overlap_pct == 100.0
    assert result.reason is None


def test_overlap_against_a_fund_with_no_holdings_is_a_named_reason() -> None:
    empty = portfolio([]).iloc[0:0]
    result = overlap_pair("S01", portfolio([("X", 1.0)]), "S02", empty)
    assert result.reason == HoldingsReason.NOT_LOADED
    assert result.overlap_pct is None


def test_turnover_is_half_the_sum_of_absolute_weight_changes() -> None:
    # X: |0.3 - 0.5| = 0.2, Y: |0 - 0.5| = 0.5, Z: |0.7 - 0| = 0.7 -> 1.4 / 2 = 0.7
    two_months = pd.concat(
        [
            portfolio([("X", 0.5), ("Y", 0.5)], as_of="2026-05-31"),
            portfolio([("X", 0.3), ("Z", 0.7)], as_of="2026-06-30"),
        ],
        ignore_index=True,
    )
    points, reason = turnover_series(two_months)
    assert reason is None
    assert [p.to_dict() for p in points] == [
        {"from_as_of": "2026-05-31", "to_as_of": "2026-06-30", "turnover": 0.7}
    ]


def test_an_unchanged_portfolio_has_zero_turnover() -> None:
    two_months = pd.concat(
        [
            portfolio([("X", 0.6), ("Y", 0.4)], as_of="2026-05-31"),
            portfolio([("X", 0.6), ("Y", 0.4)], as_of="2026-06-30"),
        ],
        ignore_index=True,
    )
    points, _ = turnover_series(two_months)
    assert points[0].turnover == 0.0


def test_turnover_needs_two_months() -> None:
    points, reason = turnover_series(portfolio([("X", 1.0)]))
    assert points == []
    assert reason == HoldingsReason.INSUFFICIENT_MONTHS


def test_concentration_counts_the_top_ten_only() -> None:
    fund = portfolio([(f"I{i:02d}", 0.05) for i in range(20)])
    assert concentration(fund) == {
        "holdings_count": 20,
        "weight_sum": 1.0,
        "top_10_concentration": 0.5,
    }


def test_sector_and_asset_splits_keep_an_unclassified_bucket() -> None:
    fund = portfolio([("X", 0.6), ("Y", 0.4)])
    fund["sector"] = ["Financials", None]
    fund["asset_type"] = ["equity", "cash"]
    assert sector_allocation(fund) == [
        {"sector": "Financials", "weight": 0.6},
        {"sector": None, "weight": 0.4},
    ]
    assert asset_type_split(fund) == [
        {"asset_type": "equity", "weight": 0.6},
        {"asset_type": "cash", "weight": 0.4},
    ]


# --------------------------------------------- cross-check against returns-based exposure


def test_an_equity_portfolio_the_style_basis_explains_does_not_diverge() -> None:
    fund = portfolio([("X", 0.9), ("Y", 0.1)])
    fund["asset_type"] = ["equity", "cash"]
    assert equity_share(fund) == 0.9
    result = exposure_cross_check(fund, style_fit_explains=True)
    assert result["diverges"] is False


def test_an_equity_portfolio_the_style_basis_cannot_explain_is_flagged() -> None:
    """Both readings are kept: the disagreement is what the fund page has to show."""
    fund = portfolio([("X", 0.9), ("Y", 0.1)])
    fund["asset_type"] = ["equity", "cash"]
    result = exposure_cross_check(fund, style_fit_explains=False)
    assert result["diverges"] is True
    assert result["holdings_equity_share"] == 0.9
    assert result["style_basis_explains_this_fund"] is False


def test_a_debt_portfolio_the_equity_basis_explains_is_flagged() -> None:
    fund = portfolio([("X", 0.9), ("Y", 0.1)])
    fund["asset_type"] = ["debt", "cash"]
    assert exposure_cross_check(fund, style_fit_explains=True)["diverges"] is True


def test_a_file_with_no_asset_type_cannot_be_cross_checked_and_says_so() -> None:
    result = exposure_cross_check(portfolio([("X", 1.0)]), style_fit_explains=True)
    assert result["diverges"] is None
    assert result["reason"] == HoldingsReason.ASSET_TYPE_MISSING


# --------------------------------------------------------------------------- dormant source


def test_the_dormant_adapter_names_the_reason_when_the_source_is_unreachable(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """No network: the source is mocked. It returned HTTP 522 on every real probe, and
    nothing in this project may reach for it - the adapter exists only so that wiring it
    up is one call the day it becomes reliable."""

    def boom(scheme_code: str, settings: Settings) -> None:
        raise httpx.ConnectError("connection refused")

    monkeypatch.setattr(holdings_enrich, "_fetch_raw", boom)
    value, reason = fetch_scheme_holdings("S01")
    assert value is None
    assert reason == EnrichReason.SOURCE_UNREACHABLE


def test_the_dormant_adapter_distinguishes_a_fund_the_source_does_not_carry(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(holdings_enrich, "_fetch_raw", lambda scheme_code, settings: None)
    value, reason = fetch_scheme_holdings("S99")
    assert value is None
    assert reason == EnrichReason.NOT_CARRIED


def test_no_pipeline_or_make_target_calls_the_dormant_adapter() -> None:
    """The gate in `docs/data-policy.md`: the engine ships, the fetch does not run."""
    repo = Path(__file__).resolve().parents[1]
    callers = [
        path
        for path in (
            *repo.glob("packages/**/*.py"),
            *repo.glob("apps/api/**/*.py"),
            repo / "Makefile",
        )
        if path.name != "holdings.py" and "fetch_scheme_holdings" in path.read_text()
    ]
    assert callers == []


def test_every_holdings_reason_has_a_description() -> None:
    descriptions = all_reason_descriptions()
    for reason in (
        HoldingsReason.NOT_LOADED,
        HoldingsReason.INSUFFICIENT_MONTHS,
        HoldingsReason.AS_OF_MISMATCH,
        HoldingsReason.ASSET_TYPE_MISSING,
    ):
        assert descriptions[reason]


def test_scheme_holdings_is_registered_on_the_shared_enrichment_registry() -> None:
    assert holdings_enrich.TABLE.name in {t.name for t in REGISTRY.tables()}
    assert holdings_enrich.TABLE.key_columns == ("scheme_code", "as_of", "instrument_key")


# --------------------------------------------------------------------------- end to end


@pytest.fixture(scope="module")
def api_client(tmp_path_factory: pytest.TempPathFactory):
    """A synthetic store with three imported portfolios, so the endpoints are exercised
    over the real import path rather than hand-inserted rows."""
    from . import fixtures_data

    pytest.importorskip("fastapi")

    tmp = tmp_path_factory.mktemp("mfstore_holdings")
    os.environ["MF_DATA_DIR"] = str(tmp / "data")
    os.environ["MF_DUCKDB_PATH"] = str(tmp / "data" / "processed" / "test.duckdb")
    get_settings.cache_clear()
    settings = get_settings()
    fixtures_data.build(settings)

    csv = tmp / "holdings.csv"
    csv.write_text(
        HEADER
        # S01 and S02 hold the same three names at different weights; S03 shares nothing.
        + "S01,2026-05-31,INE001,Alpha Ltd,0.50,Financials,equity\n"
        + "S01,2026-05-31,INE002,Beta Ltd,0.50,Energy,equity\n"
        + "S01,2026-06-30,INE001,Alpha Ltd,0.40,Financials,equity\n"
        + "S01,2026-06-30,INE002,Beta Ltd,0.30,Energy,equity\n"
        + "S01,2026-06-30,INE003,Gamma Ltd,0.30,Technology,equity\n"
        + "S02,2026-06-30,INE001,Alpha Ltd,0.20,Financials,equity\n"
        + "S02,2026-06-30,INE002,Beta Ltd,0.50,Energy,equity\n"
        + "S02,2026-06-30,INE009,Omega Ltd,0.30,Technology,equity\n"
        # S03's portfolio is five months older: comparing it is refused.
        + "S03,2026-01-31,INE001,Alpha Ltd,1.00,Financials,equity\n"
    )
    info = holdings_enrich.import_csv(csv, settings)
    assert info["rows_written"] == 9

    from fastapi.testclient import TestClient

    import mf_api.main as api_main
    from mf_api import store

    store.close_connection()
    api_main.settings = settings
    with TestClient(api_main.app) as test_client:
        yield test_client
    store.close_connection()
    get_settings.cache_clear()


def test_the_holdings_endpoint_states_the_month_and_the_concentration(api_client) -> None:
    payload = api_client.get("/schemes/S01/holdings").json()
    assert payload["as_of"] == "2026-06-30"
    assert payload["as_of_month"] == "2026-06"
    assert payload["months_available"] == ["2026-05-31", "2026-06-30"]
    assert payload["holdings_count"] == 3
    assert payload["top_10_concentration"] == 1.0
    assert [h["instrument_name"] for h in payload["holdings"]] == [
        "Alpha Ltd",
        "Beta Ltd",
        "Gamma Ltd",
    ]
    assert payload["sector_allocation"][0]["weight"] == 0.4
    assert payload["asset_type_split"] == [{"asset_type": "equity", "weight": 1.0}]


def test_the_holdings_endpoint_returns_both_readings_and_flags_the_disagreement(
    api_client,
) -> None:
    payload = api_client.get("/schemes/S01/holdings").json()
    assert payload["returns_based_exposure"]["reason"] is not None  # no style basis loaded
    assert payload["cross_check"]["holdings_equity_share"] == 1.0
    assert payload["cross_check"]["diverges"] is True
    assert payload["returns_based_exposure"]["weights"] == []


def test_a_fund_with_no_stored_holdings_gets_a_named_reason_not_an_error(api_client) -> None:
    response = api_client.get("/schemes/S04/holdings")
    assert response.status_code == 200
    payload = response.json()
    assert payload["as_of"] is None
    assert payload["reason"] == HoldingsReason.NOT_LOADED
    assert payload["reason_description"]


def test_an_unknown_scheme_is_still_a_404(api_client) -> None:
    assert api_client.get("/schemes/NOPE/holdings").status_code == 404


def test_the_turnover_endpoint_computes_the_month_over_month_change(api_client) -> None:
    payload = api_client.get("/schemes/S01/holdings/turnover").json()
    # 0.50 -> 0.40, 0.50 -> 0.30, 0 -> 0.30: (0.1 + 0.2 + 0.3) / 2 = 0.3
    assert payload["points"] == [
        {"from_as_of": "2026-05-31", "to_as_of": "2026-06-30", "turnover": 0.3}
    ]
    assert payload["latest"]["turnover"] == 0.3
    assert payload["reason"] is None


def test_the_turnover_endpoint_names_the_reason_below_two_months(api_client) -> None:
    payload = api_client.get("/schemes/S02/holdings/turnover").json()
    assert payload["points"] == []
    assert payload["reason"] == HoldingsReason.INSUFFICIENT_MONTHS
    assert payload["reason_description"]


def test_the_turnover_endpoint_names_the_reason_with_no_holdings_at_all(api_client) -> None:
    payload = api_client.get("/schemes/S04/holdings/turnover").json()
    assert payload["reason"] == HoldingsReason.NOT_LOADED


def test_the_overlap_endpoint_reports_each_pair_with_both_as_of_months(api_client) -> None:
    payload = api_client.get("/overlap", params={"codes": "S01,S02"}).json()
    pair = payload["pairs"][0]
    # Alpha min(0.40, 0.20) = 0.20, Beta min(0.30, 0.50) = 0.30 -> 50%
    assert pair["overlap_pct"] == 50.0
    assert pair["as_of_a"] == "2026-06-30"
    assert pair["as_of_b"] == "2026-06-30"
    assert [row["instrument_name"] for row in pair["shared_instruments"]] == [
        "Beta Ltd",
        "Alpha Ltd",
    ]
    assert [fund["as_of_month"] for fund in payload["funds"]] == ["2026-06", "2026-06"]


def test_the_overlap_endpoint_refuses_two_funds_five_months_apart(api_client) -> None:
    payload = api_client.get("/overlap", params={"codes": "S01,S03"}).json()
    pair = payload["pairs"][0]
    assert pair["overlap_pct"] is None
    assert pair["reason"] == HoldingsReason.AS_OF_MISMATCH
    assert pair["reason_description"]


def test_the_overlap_endpoint_names_a_fund_with_no_holdings(api_client) -> None:
    payload = api_client.get("/overlap", params={"codes": "S01,S04"}).json()
    assert payload["pairs"][0]["reason"] == HoldingsReason.NOT_LOADED
    assert payload["funds"][1]["reason"] == HoldingsReason.NOT_LOADED


def test_the_overlap_endpoint_covers_every_pair_of_up_to_five_funds(api_client) -> None:
    payload = api_client.get("/overlap", params={"codes": "S01,S02,S03,S04,S05"}).json()
    assert len(payload["pairs"]) == 10


def test_the_overlap_endpoint_refuses_fewer_than_two_or_more_than_five(api_client) -> None:
    assert api_client.get("/overlap", params={"codes": "S01"}).status_code == 422
    assert (
        api_client.get("/overlap", params={"codes": "S01,S02,S03,S04,S05,S06"}).status_code == 422
    )
    assert api_client.get("/overlap", params={"codes": "S01,S01"}).status_code == 422


# --------------------------------------------------------------------------- import


@pytest.fixture
def store(tmp_path: Path) -> Settings:
    """A store carrying nothing but two scheme_master rows - enough for the import to
    check a scheme_code against, and nothing else the contract needs."""
    from mf_analytics.db import connect, init_schema

    settings = Settings(
        mf_data_dir=tmp_path / "data", mf_duckdb_path=tmp_path / "data" / "processed" / "t.duckdb"
    )
    settings.ensure_dirs()
    with connect(settings) as con:
        init_schema(con)
        con.execute("INSERT INTO scheme_master (scheme_code) VALUES ('S01'), ('S02')")
    return settings


def stored(settings: Settings) -> pd.DataFrame:
    from mf_analytics.db import connect

    with connect(settings) as con:
        return con.execute(
            "SELECT scheme_code, as_of, instrument_key, instrument_id, weight, source "
            f"FROM {holdings_enrich.TABLE.name} ORDER BY as_of, weight DESC"
        ).fetch_df()


def write_csv(tmp_path: Path, body: str) -> Path:
    path = tmp_path / "holdings.csv"
    path.write_text(HEADER + body)
    return path


def test_import_writes_the_rows_with_full_provenance(store: Settings, tmp_path: Path) -> None:
    path = write_csv(tmp_path, GOOD_BODY)
    info = holdings_enrich.import_csv(path, store)
    assert info["rows_written"] == 4
    rows = stored(store)
    assert len(rows) == 4
    assert set(rows["source"]) == {"csv:holdings.csv"}
    # The cash line has no id, so its key falls back to the instrument name.
    assert "Cash and equivalents" in set(rows["instrument_key"])


def test_import_writes_nothing_when_any_row_fails(store: Settings, tmp_path: Path) -> None:
    path = write_csv(tmp_path, GOOD_BODY + "S01,2026-06-30,INE004,Delta Ltd,-0.1,Energy,equity\n")
    with pytest.raises(HoldingsCsvError):
        holdings_enrich.import_csv(path, store)
    assert stored(store).empty


def test_validate_checks_scheme_codes_against_the_store(store: Settings, tmp_path: Path) -> None:
    ok = holdings_enrich.validate_csv(write_csv(tmp_path, GOOD_BODY), store)
    assert ok["rows_read"] == 4
    with pytest.raises(HoldingsCsvError, match="not in scheme_master"):
        holdings_enrich.validate_csv(
            write_csv(tmp_path, "S99,2026-06-30,INE001,Alpha Ltd,1.0,Financials,equity\n"), store
        )
    assert stored(store).empty  # validation never writes


def test_re_importing_a_scheme_month_replaces_it_rather_than_merging(
    store: Settings, tmp_path: Path
) -> None:
    """A portfolio is a complete list: a position dropped from the file must be dropped
    from the store, not left behind at last month's weight."""
    holdings_enrich.import_csv(write_csv(tmp_path, GOOD_BODY), store)
    holdings_enrich.import_csv(
        write_csv(tmp_path, "S01,2026-06-30,INE001,Alpha Ltd,1.00,Financials,equity\n"), store
    )
    rows = stored(store)
    assert len(rows) == 1
    assert rows["instrument_id"].tolist() == ["INE001"]


def test_re_importing_one_month_leaves_another_month_alone(store: Settings, tmp_path: Path) -> None:
    holdings_enrich.import_csv(
        write_csv(
            tmp_path,
            "S01,2026-05-31,INE001,Alpha Ltd,1.00,Financials,equity\n"
            "S01,2026-06-30,INE002,Beta Ltd,1.00,Energy,equity\n",
        ),
        store,
    )
    holdings_enrich.import_csv(
        write_csv(tmp_path, "S01,2026-06-30,INE003,Gamma Ltd,1.00,Technology,equity\n"), store
    )
    rows = stored(store)
    assert rows["instrument_id"].tolist() == ["INE001", "INE003"]
