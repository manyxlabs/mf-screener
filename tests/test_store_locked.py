"""A rebuild holding the DuckDB file must read as a wait, not as a server fault.

A *reader* holding it must not even be that: read-only analysis (scripts/backtest_score.py)
runs against the same file while the API keeps serving.
"""

from __future__ import annotations

import multiprocessing
import time
from pathlib import Path

import duckdb
import pytest
from fastapi.testclient import TestClient

from mf_analytics.config import Settings
from mf_analytics.db import init_schema


def _hold_write_lock(path: str, holding: object, release: object) -> None:
    """Open the store for writing in another process, exactly as `make metrics` does."""
    with duckdb.connect(path):
        holding.set()  # type: ignore[attr-defined]
        release.wait(30)  # type: ignore[attr-defined]


@pytest.fixture
def locked_store(tmp_path: Path):
    settings = Settings(
        mf_data_dir=tmp_path / "data", mf_duckdb_path=tmp_path / "data" / "processed" / "s.duckdb"
    )
    settings.ensure_dirs()
    with duckdb.connect(str(settings.mf_duckdb_path)) as con:
        init_schema(con)

    ctx = multiprocessing.get_context("spawn")
    holding, release = ctx.Event(), ctx.Event()
    writer = ctx.Process(
        target=_hold_write_lock, args=(str(settings.mf_duckdb_path), holding, release)
    )
    writer.start()
    assert holding.wait(30), "the writer process never took the lock"
    # DuckDB takes the file lock as the connection opens; give the open a moment to land.
    time.sleep(0.5)
    try:
        yield settings
    finally:
        release.set()
        writer.join(30)


def test_a_request_during_a_rebuild_is_a_503_that_explains_itself(locked_store, monkeypatch):
    import mf_api.main as api_main
    from mf_api import store

    store.close_connection()
    monkeypatch.setattr(api_main, "settings", locked_store)
    monkeypatch.setattr(store, "get_settings", lambda: locked_store)
    try:
        with TestClient(api_main.app, raise_server_exceptions=False) as client:
            response = client.get("/health")
    finally:
        store.close_connection()

    assert response.status_code == 503
    assert response.headers["Retry-After"] == "30"
    assert "held by another process" in response.json()["detail"]
    # The driver's own lock text names a PID and a docs URL; neither helps a caller.
    assert "Could not set lock" not in response.json()["detail"]


def _hold_read_lock(path: str, holding: object, release: object) -> None:
    """Open the store read-only in another process, as an analysis script does."""
    with duckdb.connect(path, read_only=True):
        holding.set()  # type: ignore[attr-defined]
        release.wait(30)  # type: ignore[attr-defined]


def test_a_read_only_holder_does_not_take_the_api_down(tmp_path: Path, monkeypatch):
    """The write bootstrap is blocked, but the views are already in the file."""
    import mf_api.main as api_main
    from mf_api import store

    settings = Settings(
        mf_data_dir=tmp_path / "data", mf_duckdb_path=tmp_path / "data" / "processed" / "r.duckdb"
    )
    settings.ensure_dirs()
    with duckdb.connect(str(settings.mf_duckdb_path)) as con:
        init_schema(con)
        store.register_nav_view(con, settings)
        con.execute(store.SCREEN_VIEW_SQL)

    ctx = multiprocessing.get_context("spawn")
    holding, release = ctx.Event(), ctx.Event()
    reader = ctx.Process(
        target=_hold_read_lock, args=(str(settings.mf_duckdb_path), holding, release)
    )
    reader.start()
    assert holding.wait(30), "the reader process never opened the store"
    time.sleep(0.5)

    store.close_connection()
    monkeypatch.setattr(api_main, "settings", settings)
    monkeypatch.setattr(store, "get_settings", lambda: settings)
    try:
        with TestClient(api_main.app, raise_server_exceptions=False) as client:
            response = client.get("/health")
    finally:
        store.close_connection()
        release.set()
        reader.join(30)

    assert response.status_code == 200
