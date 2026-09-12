"""Quartile ranking: bulk SQL ranking against `rolling_returns_monthly`, then the
persistence/top-share/transition summary read off it."""

from __future__ import annotations

import pandas as pd
import pytest

from mf_analytics.db import connect, init_schema
from mf_analytics.metrics.persistence import (
    QUARTILE_METRIC_NAMES,
    build_quartile_metrics,
    rank_quartiles,
)
from mf_analytics.quality import Reason

from .fixtures_data import make_settings

VERSION = "1.0.0"


def _rolling_rows(
    *, scheme_code: str, horizon_years: int, dates: list[str], values: list[float]
) -> pd.DataFrame:
    return pd.DataFrame(
        {
            "scheme_code": scheme_code,
            "horizon_years": horizon_years,
            "date": pd.to_datetime(dates).date,
            "rolling_cagr": values,
            "methodology_version": VERSION,
        }
    )


def _load(con, frames: list[pd.DataFrame]) -> None:
    batch = pd.concat(frames, ignore_index=True)
    con.register("batch", batch)
    con.execute(
        "INSERT INTO rolling_returns_monthly "
        "SELECT scheme_code, horizon_years, date, rolling_cagr, methodology_version FROM batch"
    )
    con.unregister("batch")


@pytest.fixture
def con(tmp_path):
    settings = make_settings(tmp_path)
    with connect(settings) as connection:
        init_schema(connection)
        yield connection


def _months(n: int, start: str = "2020-01-31") -> list[str]:
    return [d.strftime("%Y-%m-%d") for d in pd.date_range(start, periods=n, freq="ME")]


def _membership(codes: list[str], category_key: str = "cat") -> pd.DataFrame:
    return pd.DataFrame({"scheme_code": codes, "category_key": category_key})


def test_one_fund_always_best_has_perfect_persistence_and_no_transitions(con):
    """8 peers, one month-end value per scheme, unchanging: A is always rank 1 of 8."""
    dates = _months(24)
    frames = [_rolling_rows(scheme_code="A", horizon_years=3, dates=dates, values=[100.0] * 24)]
    for i, v in enumerate([90.0, 80.0, 70.0, 60.0, 50.0, 40.0, 30.0]):
        frames.append(
            _rolling_rows(scheme_code=f"P{i}", horizon_years=3, dates=dates, values=[v] * 24)
        )
    _load(con, frames)
    membership = _membership(["A", *[f"P{i}" for i in range(7)]])

    ranked = rank_quartiles(con, membership, VERSION, horizons=(3,))
    metrics = build_quartile_metrics(ranked, min_peers=5)["A"]

    assert metrics["quartile_now_3y"].value == 1.0
    assert metrics["quartile_persistence_3y"].value == pytest.approx(1.0)
    assert metrics["quartile_top_share_3y"].value == pytest.approx(1.0)
    assert metrics["quartile_transitions_3y"].value == 0.0


def test_two_funds_alternating_rank_counts_one_transition_per_alternation(con):
    """A and B swap best/worst every month; 6 month ends means 5 alternations."""
    dates = _months(6)
    a_values = [100.0, 1.0, 100.0, 1.0, 100.0, 1.0]
    b_values = [1.0, 100.0, 1.0, 100.0, 1.0, 100.0]
    frames = [
        _rolling_rows(scheme_code="A", horizon_years=3, dates=dates, values=a_values),
        _rolling_rows(scheme_code="B", horizon_years=3, dates=dates, values=b_values),
    ]
    for i, v in enumerate([50.0, 45.0, 40.0, 35.0, 30.0, 25.0]):
        frames.append(
            _rolling_rows(scheme_code=f"P{i}", horizon_years=3, dates=dates, values=[v] * 6)
        )
    _load(con, frames)
    membership = _membership(["A", "B", *[f"P{i}" for i in range(6)]])

    ranked = rank_quartiles(con, membership, VERSION, horizons=(3,))
    metrics = build_quartile_metrics(ranked, min_peers=5)["A"]

    # A ends on its worst month (index 5, 0-based, value 1.0 -> bottom quartile).
    assert metrics["quartile_now_3y"].value == 4.0
    assert metrics["quartile_transitions_3y"].value == 5.0
    assert metrics["quartile_persistence_3y"].value == pytest.approx(3 / 6)
    assert metrics["quartile_top_share_3y"].value == pytest.approx(3 / 6)


def test_quartile_now_is_reported_separately_at_3y_and_5y(con):
    dates = _months(12)
    frames = [
        _rolling_rows(scheme_code="A", horizon_years=h, dates=dates, values=[100.0] * 12)
        for h in (3, 5)
    ]
    for h in (3, 5):
        for i, v in enumerate([90.0, 80.0, 70.0, 60.0, 50.0, 40.0, 30.0]):
            frames.append(
                _rolling_rows(scheme_code=f"P{i}", horizon_years=h, dates=dates, values=[v] * 12)
            )
    _load(con, frames)
    membership = _membership(["A", *[f"P{i}" for i in range(7)]])

    ranked = rank_quartiles(con, membership, VERSION, horizons=(3, 5))
    metrics = build_quartile_metrics(ranked, min_peers=5)["A"]

    assert metrics["quartile_now_3y"].value == 1.0
    assert metrics["quartile_now_5y"].value == 1.0
    # Only the 3y horizon carries persistence/top-share/transitions, per T1.4's spec.
    assert "quartile_persistence_5y" not in metrics
    assert "quartile_transitions_5y" not in metrics


def test_below_the_minimum_peer_count_quartile_is_null_with_the_named_reason(con):
    dates = _months(12)
    frames = [_rolling_rows(scheme_code="A", horizon_years=3, dates=dates, values=[100.0] * 12)]
    for i, v in enumerate([90.0, 80.0]):  # only 3 total members, below the default floor
        frames.append(
            _rolling_rows(scheme_code=f"P{i}", horizon_years=3, dates=dates, values=[v] * 12)
        )
    _load(con, frames)
    membership = _membership(["A", "P0", "P1"])

    ranked = rank_quartiles(con, membership, VERSION, horizons=(3,))
    metrics = build_quartile_metrics(ranked, min_peers=5)["A"]

    for name in QUARTILE_METRIC_NAMES:
        if name == "quartile_now_5y":
            continue  # not ranked in this test at all
        assert metrics[name].value is None
        assert metrics[name].reason == Reason.INSUFFICIENT_PEERS


def test_a_scheme_never_ranked_is_absent_from_the_result(con):
    ranked = rank_quartiles(con, _membership(["A"]), VERSION, horizons=(3,))

    assert build_quartile_metrics(ranked, min_peers=5) == {}


def test_no_membership_returns_no_metrics_without_touching_the_database(con):
    ranked = rank_quartiles(con, pd.DataFrame(columns=["scheme_code", "category_key"]), VERSION)

    assert ranked.empty
    assert build_quartile_metrics(ranked, min_peers=5) == {}
