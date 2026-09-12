"""SIP XIRR: bracketed root finder, minimum contributions, rolling median."""

from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from mf_analytics.metrics.cashflow import (
    MIN_SIP_CONTRIBUTIONS,
    NOT_BRACKETED,
    rolling_sip_xirr_median,
    sip_xirr,
)
from mf_analytics.metrics.series import to_monthly
from mf_analytics.quality import Reason

from .conftest import nav_frame


def _monthly_grid(dates: list[str], navs: list[float]) -> pd.DataFrame:
    return to_monthly(nav_frame(dates, navs))


def _continuous_growth_monthly(start: str, years: int, annual_rate: float) -> pd.DataFrame:
    """Month-end NAVs compounding continuously in real calendar days at `annual_rate`.

    XIRR discounts on actual/365 days, so a series built the same way is the one case
    where the recovered rate should match the input to numerical precision rather than
    only approximately: the compounding basis and the discounting basis are identical.
    """
    dates = pd.date_range(start, periods=years * 12 + 1, freq="ME")
    day0 = dates[0]
    days = (dates - day0).days.to_numpy(dtype=float)
    navs = 100.0 * (1.0 + annual_rate) ** (days / 365.0)
    return _monthly_grid([d.strftime("%Y-%m-%d") for d in dates], list(navs))


def _independent_newton_xirr(dates: list[pd.Timestamp], flows: list[float]) -> float:
    """A second, unrelated numerical method: Newton-Raphson from a naive 10% guess.

    Stands in for "checked in a spreadsheet" - a spreadsheet's XIRR is itself a Newton
    solve from a 10% guess, so this reproduces exactly what one would return, without
    sharing a single line with the bracketed bisection under test.
    """
    day0 = dates[0]
    days = np.array([(d - day0).days for d in dates], dtype=float)
    flows_arr = np.array(flows, dtype=float)
    rate = 0.10
    for _ in range(200):
        discount = (1.0 + rate) ** (days / 365.0)
        f = np.sum(flows_arr / discount)
        fprime = np.sum(-flows_arr * (days / 365.0) / (discount * (1.0 + rate)))
        step = f / fprime
        rate -= step
        if abs(step) < 1e-13:
            break
    return rate


def test_sip_xirr_recovers_a_constant_12pct_annual_growth():
    """Acceptance: a NAV growing at a constant 12% annually gives SIP XIRR within 1e-6 of 0.12."""
    monthly = _continuous_growth_monthly("2010-01-31", 11, 0.12)
    for years in (1, 3, 5, 10):
        result = sip_xirr(monthly, years)
        assert result.value == pytest.approx(0.12, abs=1e-6)
        assert result.n_obs == years * 12


def test_sip_xirr_matches_an_independently_computed_irregular_path():
    """Acceptance: a known irregular path matches a value computed independently."""
    dates = pd.to_datetime(
        [
            "2020-01-31",
            "2020-02-29",
            "2020-03-31",
            "2020-04-30",
            "2020-05-31",
            "2020-06-30",
            "2020-07-31",
            "2020-08-31",
            "2020-09-30",
            "2020-10-31",
            "2020-11-30",
            "2020-12-31",
            "2021-01-31",
        ]
    )
    navs = [100.0, 102.0, 90.0, 96.0, 101.0, 108.0, 112.0, 118.0, 115.0, 120.0, 130.0, 138.0, 142.0]
    monthly = _monthly_grid([d.strftime("%Y-%m-%d") for d in dates], navs)

    result = sip_xirr(monthly, years=1)
    assert result.value is not None
    assert result.n_obs == 12

    contribution_dates = list(dates[1:])
    contribution_navs = navs[1:]
    units = sum(1.0 / n for n in contribution_navs)
    redemption = units * contribution_navs[-1]
    flows = [-1.0] * (len(contribution_navs) - 1) + [redemption - 1.0]
    expected = _independent_newton_xirr(contribution_dates, flows)

    assert result.value == pytest.approx(expected, abs=1e-8)


def test_sip_xirr_requires_minimum_contributions():
    monthly = _monthly_grid(
        [d.strftime("%Y-%m-%d") for d in pd.date_range("2024-01-31", periods=6, freq="ME")],
        [100.0, 101.0, 102.0, 103.0, 104.0, 105.0],
    )
    result = sip_xirr(monthly, years=1)
    assert result.value is None
    assert result.reason == Reason.INSUFFICIENT_OBSERVATIONS
    assert result.n_obs < MIN_SIP_CONTRIBUTIONS


def test_sip_xirr_null_without_any_history():
    empty = to_monthly(pd.DataFrame(columns=["date", "nav"]))
    result = sip_xirr(empty, years=3)
    assert result.value is None
    assert result.reason == Reason.INSUFFICIENT_HISTORY


def test_sip_xirr_reports_a_named_reason_when_it_cannot_be_bracketed():
    """NAV multiplies tenfold every month: the true annualised rate is astronomic,
    far past the +2000% end of the bracket, so no rate in it prices the flows to
    zero. This must report the named reason rather than a wrong root at the edge."""
    dates = pd.date_range("2020-01-31", periods=12, freq="ME")
    navs = [10.0**i for i in range(12)]
    monthly = _monthly_grid([d.strftime("%Y-%m-%d") for d in dates], navs)
    result = sip_xirr(monthly, years=1)
    assert result.value is None
    assert result.reason == NOT_BRACKETED


def test_rolling_sip_xirr_median_requires_minimum_windows():
    monthly = _continuous_growth_monthly("2015-01-31", 1, 0.10)  # 13 month-ends: 1 window only
    result = rolling_sip_xirr_median(monthly, years=1, min_windows=12)
    assert result.value is None
    assert result.reason == Reason.INSUFFICIENT_WINDOWS


def test_rolling_sip_xirr_median_matches_constant_growth():
    monthly = _continuous_growth_monthly("2010-01-31", 6, 0.09)
    result = rolling_sip_xirr_median(monthly, years=3, min_windows=12)
    assert result.value == pytest.approx(0.09, abs=1e-6)
    assert result.n_obs >= 12
