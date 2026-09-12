"""Drawdown episodes, capture ratios and calendar-year returns."""

from __future__ import annotations

import numpy as np
import pandas as pd

from mf_analytics.metrics.risk import capture_ratios, drawdown_episodes, max_drawdown
from mf_analytics.metrics.series import calendar_year_returns
from mf_analytics.quality import Reason


def nav(values: list[float], start: str = "2020-01-31") -> pd.Series:
    index = pd.date_range(start, periods=len(values), freq="ME")
    return pd.Series(values, index=index)


def test_two_separate_falls_are_two_episodes_not_one() -> None:
    """A recovery to the old high ends an episode: 2020 and 2022 must not merge."""
    series = nav([100, 70, 100, 110, 88, 110, 120])

    episodes = drawdown_episodes(series, min_depth=0.10)

    assert len(episodes) == 2
    assert [round(e.depth, 4) for e in episodes] == [-0.30, -0.20]
    assert episodes[0].peak_date == pd.Timestamp("2020-01-31")
    assert episodes[0].trough_date == pd.Timestamp("2020-02-29")
    assert episodes[0].recovered_date == pd.Timestamp("2020-03-31")


def test_a_fall_that_never_recovered_is_kept_and_marked_open() -> None:
    episodes = drawdown_episodes(nav([100, 120, 60, 70, 80]), min_depth=0.10)

    assert len(episodes) == 1
    assert episodes[0].recovered_date is None
    assert episodes[0].days_to_recover is None
    assert episodes[0].days_to_trough > 0


def test_shallow_wobbles_are_not_episodes() -> None:
    assert drawdown_episodes(nav([100, 97, 100, 96, 101]), min_depth=0.10) == []


def test_the_worst_episode_agrees_with_max_drawdown() -> None:
    """Two definitions of the same fall must not disagree."""
    series = nav([100, 70, 100, 110, 88, 110, 120])

    worst = drawdown_episodes(series, min_depth=0.01)[0]
    single = max_drawdown(series)

    assert single.metric.value is not None
    assert round(worst.depth, 10) == round(single.metric.value, 10)
    assert worst.trough_date == single.trough_date
    assert worst.peak_date == single.peak_date


def test_a_fund_that_tracks_its_peers_exactly_captures_all_of_both_sides() -> None:
    peers = pd.Series([0.03, -0.02] * 12, index=pd.date_range("2020-01-31", periods=24, freq="ME"))

    capture = capture_ratios(peers, peers, min_obs=12)

    assert capture.up.value is not None and capture.down.value is not None
    assert np.isclose(capture.up.value, 1.0)
    assert np.isclose(capture.down.value, 1.0)


def test_a_fund_that_moves_half_as_far_captures_about_half_of_each_side() -> None:
    peers = pd.Series([0.01, -0.01] * 12, index=pd.date_range("2020-01-31", periods=24, freq="ME"))

    capture = capture_ratios(peers * 0.5, peers, min_obs=12)

    assert capture.up.value is not None and capture.down.value is not None
    # Capture is cumulative, not averaged, so halving each monthly move lands near a half
    # rather than exactly on it. The gap widens with the size of the move, which is why
    # this uses one percent a month: at ten percent, half the move captures only 0.37.
    assert abs(capture.up.value - 0.5) < 0.05
    assert abs(capture.down.value - 0.5) < 0.05


def test_capture_needs_enough_paired_months() -> None:
    index = pd.date_range("2020-01-31", periods=6, freq="ME")
    capture = capture_ratios(pd.Series(0.01, index=index), pd.Series(0.02, index=index))

    assert capture.up.value is None
    assert capture.up.reason == Reason.INSUFFICIENT_OBSERVATIONS


def test_capture_reports_no_overlap_when_the_comparison_never_fell() -> None:
    index = pd.date_range("2020-01-31", periods=24, freq="ME")
    capture = capture_ratios(pd.Series(0.01, index=index), pd.Series(0.02, index=index))

    assert capture.up.value is not None
    assert capture.down.value is None
    assert capture.down.reason == Reason.NO_OVERLAP


def test_calendar_years_compound_the_months_they_contain() -> None:
    index = pd.date_range("2024-10-31", periods=6, freq="ME")
    returns = pd.Series([0.01] * 6, index=index)

    by_year = {row["year"]: row for row in calendar_year_returns(returns).to_dict("records")}

    # A partial year is reported, and `months` is what shows that it is partial.
    assert by_year[2024]["months"] == 3
    assert by_year[2025]["months"] == 3
    assert np.isclose(by_year[2024]["fund_return"], 1.01**3 - 1)


def test_calendar_years_of_an_empty_series_is_empty_not_an_error() -> None:
    assert calendar_year_returns(pd.Series(dtype=float)).empty


def test_snapshot_capture_and_live_behaviour_capture_both_come_from_capture_ratios(
    tmp_path_factory,
) -> None:
    """The snapshot and `/behaviour` must agree, which T1.3 requires of them.

    They used to differ: the snapshot windowed capture to the trailing 3 and 5 years
    against the leave-one-out peer average, while `/behaviour` measured the fund's whole
    history against the whole sub-category average including the fund itself. Both were
    called "up capture" in the UI, so the same fund showed two different numbers
    depending on the screen. The endpoint now serves the stored columns, so agreement is
    structural rather than two implementations being kept in step by hand. This asserts
    the snapshot is exactly `capture_ratios` on its documented inputs, and that the
    endpoint returns those same values.
    """
    import os

    import pytest

    pytest.importorskip("fastapi")
    from fastapi.testclient import TestClient

    from mf_analytics.config import get_settings
    from mf_analytics.db import connect
    from mf_analytics.pipeline import CAPTURE_HORIZONS, MIN_RISK_OBS
    from mf_analytics.pipeline import run as run_metrics

    from . import fixtures_data

    tmp = tmp_path_factory.mktemp("mfbehaviour")
    os.environ["MF_DATA_DIR"] = str(tmp / "data")
    os.environ["MF_DUCKDB_PATH"] = str(tmp / "data" / "processed" / "test.duckdb")
    get_settings.cache_clear()
    settings = get_settings()
    fixtures_data.build(settings)
    run_metrics(settings)

    code = "S01"
    with connect(settings, read_only=True) as con:
        as_of = pd.Timestamp(
            con.execute(
                "SELECT as_of_date FROM scheme_metrics_snapshot WHERE scheme_code = ?", [code]
            ).fetchone()[0]
        )
        category_key = con.execute(
            "SELECT category_key FROM scheme_metrics_snapshot WHERE scheme_code = ?", [code]
        ).fetchone()[0]
        members = [
            str(r[0])
            for r in con.execute(
                "SELECT m.scheme_code FROM scheme_master m "
                "WHERE m.clean_sub_category = 'Mid Cap Fund' AND m.clean_plan = 'Direct' "
                "AND m.clean_option = 'Growth' AND m.is_active"
            ).fetchall()
        ]
        monthly = {
            c: pd.Series(
                rows["monthly_return"].to_numpy(),
                index=pd.DatetimeIndex(pd.to_datetime(rows["date"])),
            )
            for c in members
            for rows in [
                con.execute(
                    "SELECT date, monthly_return FROM monthly_returns "
                    "WHERE scheme_code = ? ORDER BY date",
                    [c],
                ).fetch_df()
            ]
        }
        snapshot_row = con.execute(
            "SELECT upside_capture_3y, upside_capture_5y, downside_capture_3y, "
            "downside_capture_5y FROM scheme_metrics_snapshot WHERE scheme_code = ?",
            [code],
        ).fetchone()
        category_series = con.execute(
            "SELECT date, category_return_equal_weighted FROM category_monthly_returns "
            "WHERE category_key = ? ORDER BY date",
            [category_key],
        ).fetch_df()

    fund_full = monthly[code].dropna()
    peers_ex_self = (
        pd.DataFrame({c: r for c, r in monthly.items() if c != code}).mean(axis=1).dropna()
    )
    whole_category = pd.Series(
        category_series["category_return_equal_weighted"].to_numpy(),
        index=pd.DatetimeIndex(pd.to_datetime(category_series["date"])),
    ).dropna()

    for i, h in enumerate(CAPTURE_HORIZONS):
        start = as_of - pd.DateOffset(years=h)
        fund_h = fund_full[(fund_full.index > start) & (fund_full.index <= as_of)]
        peers_h = peers_ex_self[(peers_ex_self.index > start) & (peers_ex_self.index <= as_of)]
        expected = capture_ratios(fund_h, peers_h, MIN_RISK_OBS[h])
        assert snapshot_row[i] == pytest.approx(expected.up.value)
        assert snapshot_row[i + len(CAPTURE_HORIZONS)] == pytest.approx(expected.down.value)

    import mf_api.main as api_main
    from mf_api import store

    store.close_connection()
    api_main.settings = settings
    with TestClient(api_main.app) as client:
        behaviour = client.get(f"/schemes/{code}/behaviour").json()
    store.close_connection()

    assert behaviour["capture_peer_basis"] == "leave_one_out_category_average"
    for i, h in enumerate(CAPTURE_HORIZONS):
        served = behaviour["capture_by_horizon"][f"{h}y"]
        assert served["up"] == pytest.approx(snapshot_row[i])
        assert served["down"] == pytest.approx(snapshot_row[i + len(CAPTURE_HORIZONS)])
    # The pair the fund page reads is the shortest horizon, named on the payload so the
    # UI never has to assume which one it is.
    assert behaviour["capture"]["horizon_years"] == CAPTURE_HORIZONS[0]
    assert behaviour["capture"]["up"] == pytest.approx(snapshot_row[0])

    # And it is genuinely not the old whole-category number, which is what regressing
    # this would silently restore.
    whole = capture_ratios(fund_full, whole_category, MIN_RISK_OBS[3])
    assert behaviour["capture"]["up"] != pytest.approx(whole.up.value)
