"""Trailing CAGR, rolling CAGR and monthly resampling."""

from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from mf_analytics.metrics.series import (
    beat_pct,
    last_scale_break,
    monthly_returns,
    rolling_cagr,
    summarise_rolling,
    to_monthly,
    trailing_cagr,
)
from mf_analytics.quality import Reason

from .conftest import constant_growth_nav, nav_frame


def test_trailing_cagr_doubles_over_five_years():
    """A NAV that doubles in exactly 5 years must return 2**(1/5) - 1."""
    monthly = to_monthly(nav_frame(["2020-12-31", "2025-12-31"], [100.0, 200.0]))
    # only two observations, so build the grid explicitly through a monthly series
    daily = nav_frame(
        [d.strftime("%Y-%m-%d") for d in pd.date_range("2020-12-31", "2025-12-31", freq="ME")],
        list(np.linspace(100.0, 200.0, len(pd.date_range("2020-12-31", "2025-12-31", freq="ME")))),
    )
    daily.loc[daily.index[-1], "nav"] = 200.0
    monthly = to_monthly(daily)
    result = trailing_cagr(monthly, 5)
    assert result.metric.value == pytest.approx(2 ** (1 / 5) - 1, rel=1e-12)
    assert result.start_date == pd.Timestamp("2020-12-31")
    assert result.end_date == pd.Timestamp("2025-12-31")


def test_trailing_cagr_matches_constant_growth():
    monthly = to_monthly(constant_growth_nav("2016-01-31", 120, 0.01))
    for years in (1, 3, 5, 10):
        expected = (1.01**12) - 1
        assert trailing_cagr(monthly, years).metric.value == pytest.approx(expected, rel=1e-12)


def test_trailing_cagr_null_without_history():
    monthly = to_monthly(constant_growth_nav("2023-01-31", 24, 0.01))
    result = trailing_cagr(monthly, 10)
    assert result.metric.value is None
    assert result.metric.reason == Reason.INSUFFICIENT_HISTORY


def test_trailing_cagr_rejects_start_outside_tolerance():
    """A 3-month hole around the required start month must not be silently bridged."""
    frame = constant_growth_nav("2016-01-31", 120, 0.01)
    frame = frame[~frame["date"].isin(pd.date_range("2021-01-31", periods=3, freq="ME"))]
    monthly = to_monthly(frame)
    result = trailing_cagr(monthly, 5, tolerance_days=10)
    assert result.metric.value is None
    assert result.metric.reason == Reason.OUT_OF_TOLERANCE


def test_rolling_cagr_series_length_and_value():
    monthly = to_monthly(constant_growth_nav("2010-01-31", 180, 0.008))
    for years in (3, 5, 10):
        series = rolling_cagr(monthly, years)
        assert len(series) == 181 - 12 * years
        assert series.iloc[0] == pytest.approx((1.008**12) - 1, rel=1e-12)


def test_rolling_cagr_empty_when_history_too_short():
    monthly = to_monthly(constant_growth_nav("2020-01-31", 24, 0.01))
    assert rolling_cagr(monthly, 3).empty


def test_summarise_rolling_statistics():
    series = pd.Series(
        [0.10, -0.05, 0.20, 0.00, 0.15, -0.10, 0.05, 0.25, 0.30, -0.02, 0.12, 0.08],
        index=pd.date_range("2020-01-31", periods=12, freq="ME"),
    )
    summary = summarise_rolling(series, min_windows=12)
    assert summary.window_count == 12
    assert summary.mean.value == pytest.approx(series.mean())
    assert summary.median.value == pytest.approx(series.median())
    assert summary.minimum.value == pytest.approx(-0.10)
    assert summary.maximum.value == pytest.approx(0.30)
    assert summary.std.value == pytest.approx(series.std(ddof=1))
    assert summary.positive_pct.value == pytest.approx(8 / 12)  # 0.00 is not positive


def test_summarise_rolling_requires_minimum_windows():
    series = pd.Series([0.1, 0.2], index=pd.date_range("2020-01-31", periods=2, freq="ME"))
    summary = summarise_rolling(series, min_windows=12)
    assert summary.median.value is None
    assert summary.median.reason == Reason.INSUFFICIENT_WINDOWS


def test_beat_pct_uses_only_aligned_windows():
    index = pd.date_range("2020-01-31", periods=12, freq="ME")
    fund = pd.Series(np.linspace(0.05, 0.16, 12), index=index)
    peer = pd.Series(0.10, index=index)
    result = beat_pct(fund, peer, min_windows=12)
    assert result.n_obs == 12
    assert result.value == pytest.approx((fund > 0.10).mean())


def test_monthly_resampling_keeps_gaps_as_gaps():
    """A missing month stays NaN and severs the return chain; it is never forward-filled."""
    frame = constant_growth_nav("2020-01-31", 12, 0.01)
    frame = frame[frame["date"] != pd.Timestamp("2020-06-30")]
    monthly = to_monthly(frame)
    assert monthly.loc["2020-06-30", "nav"] is np.nan or pd.isna(monthly.loc["2020-06-30", "nav"])
    returns = monthly_returns(monthly)["monthly_return"]
    assert pd.isna(returns.loc["2020-06-30"])
    assert pd.isna(returns.loc["2020-07-31"])
    assert returns.loc["2020-05-31"] == pytest.approx(0.01)


def test_monthly_resampling_uses_last_nav_in_month():
    frame = nav_frame(
        ["2024-01-10", "2024-01-25", "2024-01-31", "2024-02-29"], [100.0, 105.0, 110.0, 121.0]
    )
    monthly = to_monthly(frame)
    assert monthly.loc["2024-01-31", "nav"] == 110.0
    assert monthly_returns(monthly)["monthly_return"].loc["2024-02-29"] == pytest.approx(0.1)


def test_incomplete_current_month_is_dropped():
    """A part-month must never be compared against a full one."""
    frame = nav_frame(
        ["2026-06-30", "2026-07-31", "2026-08-31", "2026-09-07"], [100, 101, 102, 103]
    )
    monthly = to_monthly(frame, tolerance_days=10)
    assert monthly.index[-1] == pd.Timestamp("2026-08-31")


def test_zero_and_negative_navs_are_discarded():
    """AMFI files 0.00 as a terminal marker on matured schemes; it is not a price."""
    frame = nav_frame(["2024-01-31", "2024-02-29", "2024-03-31"], [100.0, 0.0, 110.0])
    monthly = to_monthly(frame)
    assert pd.isna(monthly.loc["2024-02-29", "nav"])
    assert monthly["nav"].notna().sum() == 2


def test_a_tenfold_nav_jump_is_detected_as_a_scale_break() -> None:
    """A face-value redenomination, not a market move: the ratio is exactly 10."""
    nav = pd.Series(
        [100.0, 101.0, 102.0, 1030.0, 1040.0],
        index=pd.date_range("2022-04-30", periods=5, freq="ME"),
    )

    assert last_scale_break(nav, jump_ratio=2.0) == pd.Timestamp("2022-07-31")


def test_a_reverse_redenomination_is_detected_too() -> None:
    nav = pd.Series(
        [1000.0, 1010.0, 101.5, 102.0],
        index=pd.date_range("2022-04-30", periods=4, freq="ME"),
    )

    assert last_scale_break(nav, jump_ratio=2.0) == pd.Timestamp("2022-06-30")


def test_a_violent_but_plausible_month_is_not_a_scale_break() -> None:
    """March 2020 fell hard; nothing in Indian mutual fund history doubles in a month."""
    nav = pd.Series(
        [100.0, 65.0, 78.0, 95.0], index=pd.date_range("2020-01-31", periods=4, freq="ME")
    )

    assert last_scale_break(nav, jump_ratio=2.0) is None


def test_a_clean_series_has_no_scale_break() -> None:
    nav = constant_growth_nav("2015-01-31", 60, 0.008).set_index("date")["nav"]

    assert last_scale_break(nav, jump_ratio=2.0) is None


def test_only_the_most_recent_break_is_reported() -> None:
    """The comparable history starts after the last one, so that is the one that matters."""
    nav = pd.Series(
        [1.0, 10.1, 10.2, 102.0, 103.0],
        index=pd.date_range("2018-01-31", periods=5, freq="ME"),
    )

    assert last_scale_break(nav, jump_ratio=2.0) == pd.Timestamp("2018-04-30")
