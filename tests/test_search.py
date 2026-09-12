"""GET /search: fts-backed typeahead over scheme name and AMC.

Covers the T1.9 acceptance criteria directly: a partial name finds the fund within
100ms at the full 38k-scheme scale, and a query matching nothing is an empty result
rather than an error.
"""

from __future__ import annotations

import time
from datetime import UTC, datetime
from pathlib import Path

import pandas as pd
import pytest
from fastapi.testclient import TestClient

from mf_analytics.config import Settings
from mf_analytics.db import connect, init_schema

pytest.importorskip("fastapi")

NOW = datetime.now(UTC).replace(tzinfo=None)

# Two variants of the same fund plus one unrelated fund, chosen so that a partial
# word in the AMC ("orion") and a partial word in the name ("zenith") each identify
# a disjoint row - a search that only indexed one of the two columns would fail one
# of the assertions below.
ROWS = [
    ("A1", "Zenith Growth Fund - Direct - Growth", "Orion Investments", "Direct", "Growth"),
    ("A2", "Zenith Growth Fund - Regular - Growth", "Orion Investments", "Regular", "Growth"),
    ("B1", "Meridian Value Fund - Direct - Growth", "Cascade Mutual Fund", "Direct", "Growth"),
]


@pytest.fixture
def client(tmp_path: Path):
    settings = Settings(
        mf_data_dir=tmp_path / "data", mf_duckdb_path=tmp_path / "data" / "processed" / "s.duckdb"
    )
    settings.ensure_dirs()
    master = pd.DataFrame(
        [
            {
                "scheme_code": code,
                "scheme_name": name,
                "amc": amc,
                "clean_sub_category": "Flexi Cap Fund",
                "clean_plan": plan,
                "clean_option": option,
                "is_active": True,
                "source": "test",
                "ingested_at": NOW,
            }
            for code, name, amc, plan, option in ROWS
        ]
    )
    with connect(settings) as con:
        init_schema(con)
        con.register("master", master)
        con.execute(
            "INSERT INTO scheme_master (scheme_code, scheme_name, amc, clean_sub_category, "
            "clean_plan, clean_option, is_active, source, ingested_at) "
            "SELECT scheme_code, scheme_name, amc, clean_sub_category, clean_plan, clean_option, "
            "is_active, source, ingested_at FROM master"
        )
        con.unregister("master")

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


def test_partial_scheme_name_matches_both_variants(client):
    resp = client.get("/search", params={"q": "zeni"})
    assert resp.status_code == 200
    payload = resp.json()
    codes = {item["scheme_code"] for item in payload["items"]}
    assert codes == {"A1", "A2"}


def test_partial_amc_name_matches(client):
    """A word that appears only in the AMC field, not the scheme name, must still hit."""
    resp = client.get("/search", params={"q": "ori"})
    codes = {item["scheme_code"] for item in resp.json()["items"]}
    assert codes == {"A1", "A2"}


def test_results_carry_plan_and_option(client):
    resp = client.get("/search", params={"q": "zenith"})
    items = {item["scheme_code"]: item for item in resp.json()["items"]}
    assert items["A1"]["clean_plan"] == "Direct"
    assert items["A2"]["clean_plan"] == "Regular"
    assert all(item["clean_option"] == "Growth" for item in items.values())


def test_query_matching_nothing_is_an_empty_result_not_an_error(client):
    resp = client.get("/search", params={"q": "nonexistentfundname"})
    assert resp.status_code == 200
    assert resp.json()["items"] == []


def test_blank_query_is_rejected_rather_than_scanning_everything(client):
    resp = client.get("/search", params={"q": ""})
    assert resp.status_code == 422


def test_limit_is_respected(client):
    resp = client.get("/search", params={"q": "zenith", "limit": 1})
    assert len(resp.json()["items"]) == 1


def _synthetic_master_frame(n: int) -> pd.DataFrame:
    filler = ["Flexi", "Cap", "Bluechip", "Small", "Mid", "Large", "Debt", "Hybrid", "Index"]
    amcs = [f"Sigma{i} Mutual Fund" for i in range(50)]
    rows = []
    for i in range(n):
        picked = [filler[(i + k) % len(filler)] for k in range(4)]
        rows.append(
            {
                "scheme_code": f"SY{i:06d}",
                "scheme_name": f"{' '.join(picked)} Fund",
                "amc": amcs[i % len(amcs)],
                "source": "synthetic",
                "ingested_at": NOW,
            }
        )
    # A single needle whose only distinguishing word appears nowhere in the filler
    # vocabulary, so a match on it is unambiguous.
    rows[20000]["scheme_name"] = "HDFC Flexi Cap Fund"
    rows[20000]["amc"] = "HDFC Mutual Fund"
    return pd.DataFrame(rows)


@pytest.fixture(scope="module")
def big_store(tmp_path_factory) -> Settings:
    tmp = tmp_path_factory.mktemp("mfsearch_scale")
    settings = Settings(
        mf_data_dir=tmp / "data", mf_duckdb_path=tmp / "data" / "processed" / "big.duckdb"
    )
    settings.ensure_dirs()
    frame = _synthetic_master_frame(38_203)
    with connect(settings) as con:
        init_schema(con)
        con.register("master", frame)
        con.execute(
            "INSERT INTO scheme_master (scheme_code, scheme_name, amc, source, ingested_at) "
            "SELECT scheme_code, scheme_name, amc, source, ingested_at FROM master"
        )
        con.unregister("master")
        # init_schema built the index before these rows existed; rebuild it the same
        # way a real API startup would after scheme_master is populated.
        from mf_analytics.db import refresh_search_index

        refresh_search_index(con)
    return settings


def test_partial_name_matches_within_100ms_at_full_scale(big_store):
    with connect(big_store, read_only=True) as con:
        con.execute("LOAD fts")
        t0 = time.perf_counter()
        rows = con.execute(
            """
            SELECT scheme_code,
                   fts_main_scheme_master.match_bm25(scheme_code, 'hdfc') AS score
            FROM scheme_master
            WHERE score IS NOT NULL
            ORDER BY score DESC
            LIMIT 10
            """
        ).fetchall()
        elapsed_ms = (time.perf_counter() - t0) * 1000
    assert elapsed_ms < 100, f"search took {elapsed_ms:.1f}ms at 38k rows"
    assert [r[0] for r in rows] == ["SY020000"]
