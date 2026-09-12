"""A scheme with no metrics row must say which kind of nothing it is."""

from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path

import pandas as pd
import pytest
from fastapi.testclient import TestClient

from mf_analytics.config import Settings
from mf_analytics.db import connect, init_schema
from mf_analytics.ingest.nav import refresh_monthly_tables, register_nav_view, write_nav_dataset

# code -> the NAV rows the source publishes for it
SOURCE: dict[str, list[tuple[str, float]]] = {
    "ZERO": [("2011-08-31", 0.0), ("2011-09-01", 0.0)],
    "ONEMONTH": [("2011-08-29", 10.0), ("2011-08-30", 10.1)],
    "NONE": [],
    "FINE": [
        (d.strftime("%Y-%m-%d"), 10.0 + i)
        for i, d in enumerate(pd.date_range("2011-01-31", periods=40, freq="ME"))
    ],
}


@pytest.fixture
def client(tmp_path: Path):
    settings = Settings(
        mf_data_dir=tmp_path / "data", mf_duckdb_path=tmp_path / "data" / "processed" / "s.duckdb"
    )
    settings.ensure_dirs()
    now = datetime.now(UTC).replace(tzinfo=None)
    master = pd.DataFrame(
        [
            {
                "scheme_code": code,
                "scheme_name": f"{code} Fund - Direct - Growth",
                "clean_plan": "Direct",
                "clean_option": "Growth",
                "is_active": False,
                "source": "test",
                "ingested_at": now,
            }
            for code in SOURCE
        ]
    )
    nav = pd.DataFrame(
        [(code, d, v) for code, rows in SOURCE.items() for d, v in rows],
        columns=["scheme_code", "date", "nav"],
    )
    with connect(settings) as con:
        init_schema(con)
        register_nav_view(con, settings)
        con.register("master", master)
        con.execute(
            "INSERT INTO scheme_master (scheme_code, scheme_name, clean_plan, clean_option, "
            "is_active, source, ingested_at) SELECT scheme_code, scheme_name, clean_plan, "
            "clean_option, is_active, source, ingested_at FROM master"
        )
        con.unregister("master")
        con.register("src", nav)
        write_nav_dataset(con, "SELECT scheme_code, date, nav, 0 AS priority FROM src", settings)
        con.unregister("src")
        refresh_monthly_tables(con, settings.mf_month_end_tolerance_days)

    import mf_api.main as api_main
    from mf_api import store

    store.close_connection()
    api_main.settings = settings
    original = store.get_settings
    store.get_settings = lambda: settings  # type: ignore[assignment]
    try:
        with TestClient(api_main.app) as test_client:
            yield test_client
    finally:
        store.get_settings = original  # type: ignore[assignment]
        store.close_connection()


@pytest.mark.parametrize(
    ("code", "reason"),
    [
        ("ZERO", "all_navs_non_positive"),
        ("ONEMONTH", "too_few_month_end_observations"),
        ("NONE", "no_nav_history"),
    ],
)
def test_a_scheme_without_metrics_names_the_reason(client, code: str, reason: str) -> None:
    payload = client.get(f"/schemes/{code}").json()

    assert payload["metrics_unavailable"]["reason"] == reason
    assert payload["metrics_unavailable"]["description"]


def test_the_metrics_endpoint_stops_telling_people_to_rebuild(client) -> None:
    """No rebuild can give a terminal-zero scheme metrics, so it must not suggest one."""
    response = client.get("/schemes/ZERO/metrics")

    assert response.status_code == 404
    assert "make data-build" not in response.json()["detail"]
    assert "Rebuilding will not change this" in response.json()["detail"]


def test_a_scheme_that_does_have_a_snapshot_reports_nothing_unavailable(client) -> None:
    from mf_analytics.pipeline import run as run_metrics
    from mf_api import store

    store.close_connection()
    run_metrics(store.get_settings())

    assert client.get("/schemes/FINE").json()["metrics_unavailable"] is None


def test_survivorship_gap_matches_hand_computed_amount(tmp_path: Path) -> None:
    """T2.4 acceptance: the fixture's Small Cap Fund sub-category has S09, S10, S11
    active and S12 a matured underperformer (weaker drift, shorter history). The
    all-schemes 10y category average must sit below the active-only average by the
    amount hand-computed straight from the schemes' own stored monthly returns,
    independent of the category-context code under test.
    """
    from mf_analytics.pipeline import run as run_metrics
    from mf_analytics.universe import DEFAULT_UNIVERSE, counterpart_category_key

    from . import fixtures_data

    settings = Settings(
        mf_data_dir=tmp_path / "data",
        mf_duckdb_path=tmp_path / "data" / "processed" / "surv.duckdb",
    )
    fixtures_data.build(settings)
    run_metrics(settings)

    active_key = DEFAULT_UNIVERSE.category_key("Small Cap Fund")
    all_schemes_key = counterpart_category_key(active_key)

    with connect(settings) as con:
        returns = con.execute(
            "SELECT scheme_code, date, monthly_return FROM monthly_returns "
            "WHERE scheme_code IN ('S09', 'S10', 'S11', 'S12') ORDER BY date"
        ).fetch_df()
    wide = returns.pivot(index="date", columns="scheme_code", values="monthly_return")

    def trailing_10y_cagr(members: list[str]) -> float:
        avg = wide.loc[:, members].mean(axis=1).dropna().sort_index()
        index = (1.0 + avg).cumprod() * 100.0
        end, start = index.iloc[-1], index.iloc[-121]  # 121 = 10 years of month-ends + anchor
        return float((end / start) ** (1.0 / 10.0) - 1.0)

    expected_active = trailing_10y_cagr(["S09", "S10", "S11"])
    expected_all = trailing_10y_cagr(["S09", "S10", "S11", "S12"])
    assert expected_all < expected_active
    expected_gap_pp = round((expected_active - expected_all) * 100, 4)

    import mf_api.main as api_main
    from mf_api import store

    store.close_connection()
    api_main.settings = settings
    original_get_settings = store.get_settings
    store.get_settings = lambda: settings  # type: ignore[assignment]
    try:
        with TestClient(api_main.app) as test_client:
            payload = test_client.get(f"/categories/{active_key}/metrics").json()
            mirrored = test_client.get(f"/categories/{all_schemes_key}/metrics").json()
    finally:
        store.get_settings = original_get_settings  # type: ignore[assignment]
        store.close_connection()

    assert payload["active_only"]["cagr_10y"] == pytest.approx(expected_active)
    assert payload["all_schemes"]["cagr_10y"] == pytest.approx(expected_all)
    assert payload["survivorship_gap_pp"]["cagr_10y"] == pytest.approx(expected_gap_pp)

    # Querying by either side of the pair returns the same active_only/all_schemes pair.
    assert mirrored["active_only"]["cagr_10y"] == payload["active_only"]["cagr_10y"]
    assert mirrored["all_schemes"]["cagr_10y"] == payload["all_schemes"]["cagr_10y"]
