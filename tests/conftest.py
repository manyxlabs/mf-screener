from __future__ import annotations

import pathlib

import duckdb
import numpy as np
import pandas as pd
import pytest

from mf_analytics.config import REPO_ROOT


def _configured_store() -> pathlib.Path | None:
    """The DuckDB path `.env` points at: the one no test may ever open."""
    env = REPO_ROOT / ".env"
    if not env.exists():
        return None
    for line in env.read_text().splitlines():
        key, _, value = line.partition("=")
        if key.strip() == "MF_DUCKDB_PATH" and value.strip():
            return (REPO_ROOT / value.strip()).resolve()
    return None


PRODUCTION_STORE = _configured_store()


@pytest.fixture(autouse=True)
def refuse_the_configured_store(monkeypatch: pytest.MonkeyPatch) -> None:
    """Fail loudly if any test opens the store the app itself uses.

    A fixture that built `Settings()` without overriding the path once wrote its
    synthetic 15-scheme master straight into the real DuckDB. `scheme_master` and
    `scheme_metrics_snapshot` were then describing different universes, their join
    was empty, and the screener, the CSV export and /picks all returned nothing.
    Isolation used to be per-test discipline - remember `make_settings(tmp_path)` -
    which is exactly the kind of rule one new fixture forgets. Guarding
    `duckdb.connect` itself catches it wherever it is reached from.
    """
    if PRODUCTION_STORE is None:
        return
    real_connect = duckdb.connect

    def guarded(database: object = ":memory:", *args: object, **kwargs: object) -> object:
        named = isinstance(database, (str, pathlib.Path)) and str(database) not in (":memory:", "")
        if named and pathlib.Path(database).resolve() == PRODUCTION_STORE:
            raise RuntimeError(
                f"a test tried to open the configured store at {PRODUCTION_STORE}. "
                "Build a Settings with mf_duckdb_path under tmp_path, or use "
                "tests.fixtures_data.make_settings(tmp_path)."
            )
        return real_connect(database, *args, **kwargs)

    monkeypatch.setattr(duckdb, "connect", guarded)


def nav_frame(dates: list[str], navs: list[float]) -> pd.DataFrame:
    return pd.DataFrame({"date": pd.to_datetime(dates), "nav": navs})


def constant_growth_nav(
    start: str, months: int, monthly_rate: float, start_nav: float = 100.0
) -> pd.DataFrame:
    """Daily-ish NAV series (one point per month end) growing at a fixed monthly rate."""
    dates = pd.date_range(start, periods=months + 1, freq="ME")
    navs = start_nav * (1.0 + monthly_rate) ** np.arange(months + 1)
    return pd.DataFrame({"date": dates, "nav": navs})


@pytest.fixture
def rng() -> np.random.Generator:
    return np.random.default_rng(20260908)
