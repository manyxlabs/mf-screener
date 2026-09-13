"""Running the metrics build across workers must change nothing but the wall clock."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pandas as pd

from mf_analytics.db import connect
from mf_analytics.pipeline import run as run_metrics

from . import fixtures_data


def _snapshot(settings: Any) -> pd.DataFrame:
    with connect(settings, read_only=True) as con:
        return con.execute("SELECT * FROM scheme_metrics_snapshot ORDER BY scheme_code").fetch_df()


def _rolling(settings: Any) -> pd.DataFrame:
    with connect(settings, read_only=True) as con:
        return con.execute(
            "SELECT scheme_code, horizon_years, date, rolling_cagr "
            "FROM rolling_returns_monthly ORDER BY scheme_code, horizon_years, date"
        ).fetch_df()


def _build(tmp_path: Path, name: str, jobs: int) -> Any:
    settings = fixtures_data.make_settings(tmp_path / name)
    fixtures_data.build(settings)
    run_metrics(settings, jobs=jobs)
    return settings


def test_parallel_and_serial_builds_agree_row_for_row(tmp_path: Path) -> None:
    serial = _snapshot(_build(tmp_path, "serial", jobs=1))
    parallel = _snapshot(_build(tmp_path, "parallel", jobs=3))

    # computed_at is a clock reading, and the run id it carries differs by construction.
    volatile = [c for c in serial.columns if c in {"computed_at"}]
    pd.testing.assert_frame_equal(
        serial.drop(columns=volatile), parallel.drop(columns=volatile), check_like=True
    )


def test_parallel_build_writes_the_same_rolling_series(tmp_path: Path) -> None:
    serial = _rolling(_build(tmp_path, "serial_roll", jobs=1))
    parallel = _rolling(_build(tmp_path, "parallel_roll", jobs=3))
    pd.testing.assert_frame_equal(serial, parallel)


def test_a_missing_reason_survives_the_trip_back_from_a_worker(tmp_path: Path) -> None:
    """The reasons ride home as JSON on the row; a worker boundary must not flatten them."""
    settings = _build(tmp_path, "reasons", jobs=3)
    frame = _snapshot(settings)
    reasons = [json.loads(r) for r in frame["missing_reasons"]]
    assert any(r for r in reasons), "the fixture universe always has some withheld metric"
