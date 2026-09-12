"""T3.1: the enrichment contract, built before any enrichment source exists.
T3.2: `scheme_attributes`, the first source registered on it.

Covers the acceptance criteria directly: the real snapshot column list and the real
enrichment column list never intersect, a simulated unreachable source produces a
named reason rather than an exception, the screener can filter on exit load and
manager tenure, and a fund absent from the source shows named reasons in every cell.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta
from pathlib import Path

import duckdb
import httpx
import pytest

from mf_analytics import enrich
from mf_analytics.config import Settings
from mf_analytics.db import connect, init_schema
from mf_analytics.enrich import (
    PROVENANCE_COLUMNS,
    REGISTRY,
    EnrichmentRegistry,
    EnrichmentTable,
    EnrichReason,
    assert_disjoint_from_snapshot,
    enrich_http_settings,
    fetch_or_reason,
    is_stale,
)
from mf_analytics.enrich import attributes as scheme_attributes
from mf_analytics.metrics import tax as tax_metrics
from mf_analytics.quality import Metric


def real_snapshot_columns() -> set[str]:
    """The actual column list of scheme_metrics_snapshot, read off a schema built by
    db.init_schema - not a hand-maintained copy, so a future column added there is
    picked up automatically."""
    con = duckdb.connect(":memory:")
    try:
        init_schema(con)
        rows = con.execute(
            "SELECT column_name FROM information_schema.columns "
            "WHERE table_name = 'scheme_metrics_snapshot'"
        ).fetchall()
        return {r[0] for r in rows}
    finally:
        con.close()


def sample_table(
    name: str = "scheme_attributes_test", columns: dict[str, str] | None = None
) -> EnrichmentTable:
    return EnrichmentTable(
        name=name,
        columns=columns
        or {"scheme_code": "VARCHAR NOT NULL", "riskometer": "VARCHAR", "exit_load_pct": "DOUBLE"},
        key_columns=("scheme_code", "as_of"),
        description="test fixture table",
    )


def test_every_table_carries_all_four_provenance_columns() -> None:
    sql = sample_table().create_sql()
    for column, decl in PROVENANCE_COLUMNS.items():
        assert f"{column} {decl}" in sql


def test_provenance_columns_cannot_be_redeclared_by_a_table() -> None:
    with pytest.raises(ValueError, match="source"):
        EnrichmentTable(
            name="bad",
            columns={"source": "VARCHAR"},
            key_columns=("scheme_code",),
            description="x",
        )


def test_table_requires_a_key() -> None:
    with pytest.raises(ValueError, match="key_columns"):
        EnrichmentTable(name="bad", columns={"x": "VARCHAR"}, key_columns=(), description="x")


def test_registry_column_names_exclude_provenance() -> None:
    registry = EnrichmentRegistry()
    registry.register(sample_table())
    names = registry.column_names()
    assert names == {"riskometer", "exit_load_pct"}
    assert not names & set(PROVENANCE_COLUMNS)
    assert "scheme_code" not in names  # a join key, not enrichment data


def test_registry_rejects_duplicate_table_names() -> None:
    registry = EnrichmentRegistry()
    registry.register(sample_table())
    with pytest.raises(ValueError, match="already registered"):
        registry.register(sample_table())


def test_disjoint_from_real_snapshot_columns_passes_with_the_real_registry() -> None:
    # T3.2 registers scheme_attributes and T3.3 scheme_holdings on the shared REGISTRY at
    # import time - this proves the fence holds for the actual enrichment tables shipped,
    # not a stand-in.
    assert {"scheme_attributes", "scheme_holdings"} <= {t.name for t in REGISTRY.tables()}
    assert_disjoint_from_snapshot(real_snapshot_columns())


def test_no_holdings_column_reaches_the_snapshot_or_the_screening_view() -> None:
    """T3.3's fence, asserted on both surfaces a ranking could reach it through.

    `scheme_attributes` is deliberately joined into `screen_base` so exit load and
    manager tenure can be screened on. Holdings must not be: a weight, a sector or an
    overlap is a portfolio fact about one month, and a screener column is something a
    fund gets ranked by.
    """
    from mf_analytics.enrich import holdings
    from mf_api.store import SCREEN_VIEW_SQL

    columns = holdings.TABLE.domain_column_names()
    assert columns and not columns & real_snapshot_columns()
    assert holdings.TABLE.name not in SCREEN_VIEW_SQL


def test_fence_fails_when_an_enrichment_column_collides_with_the_snapshot(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Proves the fence actually fires: if a future enrichment table reuses a real
    snapshot column name, assert_disjoint_from_snapshot raises rather than passing
    silently."""
    snapshot_columns = real_snapshot_columns()
    colliding_column = sorted(c for c in snapshot_columns if c != "scheme_code")[0]
    colliding_registry = EnrichmentRegistry()
    colliding_registry.register(
        EnrichmentTable(
            name="colliding_enrichment",
            columns={colliding_column: "DOUBLE"},
            key_columns=("scheme_code",),
            description="deliberately collides for the test",
        )
    )
    monkeypatch.setattr(enrich, "REGISTRY", colliding_registry)
    with pytest.raises(AssertionError, match=colliding_column):
        assert_disjoint_from_snapshot(snapshot_columns)


def test_registry_builds_table_and_reports_coverage_and_staleness(tmp_path: Path) -> None:
    registry = EnrichmentRegistry()
    registry.register(sample_table("scheme_attributes_cov"))
    con = duckdb.connect(str(tmp_path / "e.duckdb"))
    settings = Settings(mf_data_dir=tmp_path, mf_enrich_stale_days=30)
    try:
        registry.init_schema(con)
        fresh_as_of = date.today() - timedelta(days=5)
        stale_as_of = date.today() - timedelta(days=60)
        now = datetime.now()
        con.execute(
            "INSERT INTO scheme_attributes_cov "
            "(scheme_code, as_of, riskometer, exit_load_pct, source, source_url, fetched_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?)",
            ["S01", fresh_as_of, "Very High", 1.0, "test-source", "https://example.test", now],
        )
        con.execute(
            "INSERT INTO scheme_attributes_cov "
            "(scheme_code, as_of, riskometer, exit_load_pct, source, source_url, fetched_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?)",
            ["S02", stale_as_of, "Moderate", 0.5, "test-source", "https://example.test", now],
        )
        report = registry.coverage_and_staleness(con, universe_size=4, settings=settings)
    finally:
        con.close()

    assert report == [
        {
            "table": "scheme_attributes_cov",
            "rows": 2,
            "coverage_pct": 50.0,
            "stale_rows": 1,
            "latest_as_of": fresh_as_of,
            "stale_threshold_days": 30,
        }
    ]


def test_coverage_and_staleness_reports_zero_rows_for_an_unpopulated_real_table(
    tmp_path: Path,
) -> None:
    # Since T3.2, the real REGISTRY is no longer empty - this is the correct report
    # for `make validate` to show before the source has ever been fetched from.
    con = duckdb.connect(str(tmp_path / "empty.duckdb"))
    try:
        REGISTRY.init_schema(con)
        report = REGISTRY.coverage_and_staleness(con, universe_size=10)
    finally:
        con.close()
    by_table = {r["table"]: r for r in report}
    for name in ("scheme_attributes", "scheme_holdings"):
        assert by_table[name]["rows"] == 0
        assert by_table[name]["coverage_pct"] == 0.0
        assert by_table[name]["latest_as_of"] is None


def test_is_stale_uses_the_configured_threshold() -> None:
    settings = Settings(mf_data_dir=Path("."), mf_enrich_stale_days=30)
    assert not is_stale(date.today() - timedelta(days=5), settings)
    assert is_stale(date.today() - timedelta(days=45), settings)


def test_enrich_http_settings_overrides_only_the_http_fields(tmp_path: Path) -> None:
    base = Settings(
        mf_data_dir=tmp_path,
        mf_http_timeout=180.0,
        mf_http_retries=5,
        mf_enrich_http_timeout=15.0,
        mf_enrich_http_retries=2,
        mf_enrich_http_backoff=1.5,
    )
    scoped = enrich_http_settings(base)
    assert scoped.mf_http_timeout == 15.0
    assert scoped.mf_http_retries == 2
    assert scoped.mf_http_backoff == 1.5
    # The base settings object used elsewhere in the process is untouched.
    assert base.mf_http_timeout == 180.0
    assert base.mf_http_retries == 5


def test_fetch_or_reason_turns_an_unreachable_source_into_a_named_reason() -> None:
    def unreachable() -> dict:
        raise httpx.ConnectError("connection refused")

    value, reason = fetch_or_reason(unreachable)
    assert value is None
    assert reason == EnrichReason.SOURCE_UNREACHABLE


def test_fetch_or_reason_passes_through_a_successful_value() -> None:
    value, reason = fetch_or_reason(lambda: {"riskometer": "High"})
    assert value == {"riskometer": "High"}
    assert reason is None


# ---------------------------------------------------------------------------
# T3.2: scheme_attributes
# ---------------------------------------------------------------------------


def test_scheme_attributes_is_registered_on_the_shared_registry() -> None:
    assert scheme_attributes.TABLE.name == "scheme_attributes"
    assert scheme_attributes.TABLE.key_columns == ("scheme_code",)
    assert scheme_attributes.TABLE.name in {t.name for t in REGISTRY.tables()}
    assert "manager_start_date" in scheme_attributes.TABLE.columns
    # manager_tenure_years is derived at query time - never a stored column that ages.
    assert "manager_tenure_years" not in scheme_attributes.TABLE.columns


def test_fetch_scheme_attributes_reports_source_unreachable(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def boom(scheme_code: str, settings: Settings) -> None:
        raise httpx.ConnectError("connection refused")

    monkeypatch.setattr(scheme_attributes, "_fetch_raw", boom)
    value, reason = scheme_attributes.fetch_scheme_attributes("S01")
    assert value is None
    assert reason == EnrichReason.SOURCE_UNREACHABLE


def test_fetch_scheme_attributes_reports_not_carried_for_a_404(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(scheme_attributes, "_fetch_raw", lambda scheme_code, settings: None)
    value, reason = scheme_attributes.fetch_scheme_attributes("S99")
    assert value is None
    assert reason == EnrichReason.NOT_CARRIED


def test_fetch_scheme_attributes_normalises_a_successful_response(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    raw = {
        "riskometer": "Very High",
        "riskometer_as_of": "2026-08-01",
        "exit_load_pct": 0.01,
        "exit_load_period_days": 365,
        "lock_in_days": 0,
        "min_investment": 5000.0,
        "min_sip": 500.0,
        "benchmark_name": "Nifty Midcap 150 TRI",
        "fund_manager": "A. Manager",
        "manager_start_date": "2019-03-15",
    }
    monkeypatch.setattr(scheme_attributes, "_fetch_raw", lambda scheme_code, settings: raw)
    value, reason = scheme_attributes.fetch_scheme_attributes("S01")
    assert reason is None
    assert value is not None
    assert value["riskometer"] == "Very High"
    assert value["riskometer_as_of"] == date(2026, 8, 1)
    assert value["manager_start_date"] == date(2019, 3, 15)


def test_manager_tenure_years_is_derived_at_query_time() -> None:
    assert scheme_attributes.manager_tenure_years(None) is None
    tenure = scheme_attributes.manager_tenure_years(date(2020, 1, 1), today=date(2023, 1, 1))
    assert tenure is not None
    assert 2.99 < tenure < 3.01


def test_resolve_gives_every_field_a_named_reason_for_a_fund_absent_from_the_source() -> None:
    resolved = scheme_attributes.resolve(None)
    assert set(resolved) == set(scheme_attributes.DISPLAY_FIELDS)
    for field in scheme_attributes.DISPLAY_FIELDS:
        assert resolved[field].value is None
        assert resolved[field].reason == EnrichReason.NOT_CARRIED


def test_resolve_flags_a_riskometer_older_than_one_month_as_stale() -> None:
    today = date(2026, 9, 9)
    row = {"riskometer": "High", "riskometer_as_of": today - timedelta(days=60), "as_of": today}
    resolved = scheme_attributes.resolve(row, today)
    assert resolved["riskometer"].value == "High"
    assert resolved["riskometer"].stale is True
    assert resolved["riskometer"].reason == EnrichReason.STALE


def test_resolve_does_not_flag_a_fresh_riskometer() -> None:
    today = date(2026, 9, 9)
    row = {"riskometer": "High", "riskometer_as_of": today - timedelta(days=5), "as_of": today}
    resolved = scheme_attributes.resolve(row, today)
    assert resolved["riskometer"].stale is False
    assert resolved["riskometer"].reason is None


def test_registering_scheme_attributes_twice_would_be_rejected() -> None:
    # Guards against a future edit accidentally duplicating the module-level
    # REGISTRY.register(...) call in attributes.py.
    with pytest.raises(ValueError, match="already registered"):
        REGISTRY.register(
            EnrichmentTable(
                name="scheme_attributes",
                columns={"scheme_code": "VARCHAR NOT NULL"},
                key_columns=("scheme_code",),
                description="x",
            )
        )


# ---------------------------------------------------------------------------
# T3.2: exit load wired into metrics/tax.py
# ---------------------------------------------------------------------------


def test_after_tax_lumpsum_still_withholds_without_an_exit_load_on_hand(tmp_path: Path) -> None:
    settings = Settings(mf_data_dir=tmp_path)
    gross = Metric(0.15, 60)
    result = tax_metrics.after_tax_lumpsum(gross, 2.0, "Equity Scheme", "Flexi Cap Fund", settings)
    assert result.after_tax_and_load.value is None
    assert result.after_tax_and_load.reason == tax_metrics.EXIT_LOAD_NOT_PUBLISHED


def test_after_tax_lumpsum_resolves_the_reason_once_the_field_is_present(tmp_path: Path) -> None:
    settings = Settings(mf_data_dir=tmp_path)
    gross = Metric(0.15, 60)
    result = tax_metrics.after_tax_lumpsum(
        gross,
        2.0,
        "Equity Scheme",
        "Flexi Cap Fund",
        settings,
        exit_load_pct=0.01,
        exit_load_period_days=365,
    )
    assert result.after_tax_and_load.reason is None
    assert result.after_tax_and_load.value is not None


def test_after_tax_lumpsum_applies_the_load_only_inside_its_period(tmp_path: Path) -> None:
    settings = Settings(mf_data_dir=tmp_path)
    gross = Metric(0.15, 60)
    within_period = tax_metrics.after_tax_lumpsum(
        gross,
        0.5,
        "Equity Scheme",
        "Flexi Cap Fund",
        settings,
        exit_load_pct=0.01,
        exit_load_period_days=365,
    )
    past_period = tax_metrics.after_tax_lumpsum(
        gross,
        2.0,
        "Equity Scheme",
        "Flexi Cap Fund",
        settings,
        exit_load_pct=0.01,
        exit_load_period_days=365,
    )
    assert within_period.after_tax_and_load.value < within_period.after_tax.value
    assert past_period.after_tax_and_load.value == pytest.approx(past_period.after_tax.value)


def test_after_tax_sip_applies_the_load_to_installments_still_inside_the_period(
    tmp_path: Path,
) -> None:
    import numpy as np
    import pandas as pd

    settings = Settings(mf_data_dir=tmp_path)
    dates = pd.date_range("2020-01-31", periods=37, freq="ME")
    navs = 100 * (1.02) ** np.arange(37)
    monthly = pd.DataFrame({"nav": navs}, index=dates)
    result = tax_metrics.after_tax_sip(
        monthly,
        3,
        "Equity Scheme",
        "Flexi Cap Fund",
        settings,
        exit_load_pct=0.01,
        exit_load_period_days=365,
    )
    assert result.after_tax_and_load.value is not None
    assert result.after_tax_and_load.value < result.after_tax.value


# ---------------------------------------------------------------------------
# T3.2 acceptance: an end-to-end screener filter, and named reasons on the API
# ---------------------------------------------------------------------------


@pytest.fixture(scope="module")
def api_client(tmp_path_factory: pytest.TempPathFactory):
    """A synthetic store carrying two `scheme_attributes` rows, seeded directly (no
    network) so the acceptance test exercises the real `/screen` and
    `/schemes/{code}/attributes` endpoints rather than the enrichment module alone."""
    import os

    from mf_analytics.config import get_settings
    from mf_analytics.pipeline import run as run_metrics

    from . import fixtures_data

    pytest.importorskip("fastapi")

    tmp = tmp_path_factory.mktemp("mfstore_attrs")
    os.environ["MF_DATA_DIR"] = str(tmp / "data")
    os.environ["MF_DUCKDB_PATH"] = str(tmp / "data" / "processed" / "test.duckdb")
    get_settings.cache_clear()
    settings = get_settings()
    fixtures_data.build(settings)
    run_metrics(settings)

    now = datetime.now()
    today = date.today()
    with connect(settings) as con:
        init_schema(con)
        # S01: no exit load, a manager well past three years - should pass both filters.
        con.execute(
            "INSERT INTO scheme_attributes (scheme_code, riskometer, riskometer_as_of, "
            "exit_load_pct, exit_load_period_days, lock_in_days, min_investment, min_sip, "
            "benchmark_name, fund_manager, manager_start_date, source, source_url, "
            "fetched_at, as_of) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            [
                "S01",
                "Very High",
                today,
                0.0,
                0,
                0,
                5000.0,
                500.0,
                "Nifty Midcap 150 TRI",
                "A. Manager",
                today - timedelta(days=5 * 365),
                "test-source",
                "https://example.test",
                now,
                today,
            ],
        )
        # S02: has an exit load and a fresh manager - should fail both filters.
        con.execute(
            "INSERT INTO scheme_attributes (scheme_code, riskometer, riskometer_as_of, "
            "exit_load_pct, exit_load_period_days, lock_in_days, min_investment, min_sip, "
            "benchmark_name, fund_manager, manager_start_date, source, source_url, "
            "fetched_at, as_of) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            [
                "S02",
                "High",
                today,
                0.01,
                365,
                0,
                5000.0,
                500.0,
                "Nifty Midcap 150 TRI",
                "B. Manager",
                today - timedelta(days=365),
                "test-source",
                "https://example.test",
                now,
                today,
            ],
        )
        # S03 gets no row at all: absent from the source.

    from fastapi.testclient import TestClient

    import mf_api.main as api_main
    from mf_api import store

    store.close_connection()
    api_main.settings = settings
    with TestClient(api_main.app) as test_client:
        yield test_client
    store.close_connection()


def test_screen_filters_to_no_exit_load_and_long_manager_tenure(api_client) -> None:
    payload = api_client.get(
        "/screen",
        params={
            "exit_load_pct_max": 0,
            "manager_tenure_years_min": 3,
            "sub_category": ["Mid Cap Fund"],
        },
    ).json()
    codes = {row["scheme_code"] for row in payload["rows"]}
    assert "S01" in codes
    assert "S02" not in codes
    assert "S03" not in codes  # absent from the source: cannot satisfy either filter
    assert payload["methodology"]["applied_filters"]["attribute_filters"] == {
        "exit_load_pct_max": 0.0,
        "manager_tenure_years_min": 3.0,
    }


def test_screen_is_unaffected_when_no_attribute_filter_is_given(api_client) -> None:
    payload = api_client.get("/screen", params={"sub_category": ["Mid Cap Fund"]}).json()
    codes = {row["scheme_code"] for row in payload["rows"]}
    assert {"S01", "S02", "S03"} <= codes


def test_scheme_attributes_endpoint_names_the_reason_for_a_fund_absent_from_the_source(
    api_client,
) -> None:
    payload = api_client.get("/schemes/S03/attributes").json()
    for field in scheme_attributes.DISPLAY_FIELDS:
        cell = payload["fields"][field]
        assert cell["value"] is None
        assert cell["reason"] == EnrichReason.NOT_CARRIED
        assert cell["reason_description"]


def test_scheme_attributes_endpoint_reports_a_present_row(api_client) -> None:
    payload = api_client.get("/schemes/S01/attributes").json()
    assert payload["fields"]["exit_load_pct"]["value"] == 0.0
    assert payload["fields"]["manager_tenure_years"]["value"] > 3
    assert payload["source"] == "test-source"


def test_net_returns_resolves_the_exit_load_reason_once_the_field_exists(api_client) -> None:
    payload = api_client.get(
        "/schemes/S02/net-returns", params={"horizon": 1, "mode": "lumpsum"}
    ).json()
    assert payload["after_tax_and_load_return"]["reason"] != tax_metrics.EXIT_LOAD_NOT_PUBLISHED
