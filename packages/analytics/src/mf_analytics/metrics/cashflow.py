"""SIP XIRR: the annualised return an investor actually experienced.

Trailing CAGR compares one lump sum in to one lump sum out. Most investors instead
put money in every month, so the return that matters is the one on that contribution
schedule: one unit bought at each month-end NAV in the window, all of it redeemed at
the window's last observation. The rate is found with a bracketed root finder (a
bisection on the cash-flow NPV, the same guarantee `scipy.optimize.brentq` gives) so a
cash-flow series with no solution in a plausible range fails with a named reason
rather than returning whatever a Newton guess happened to converge to.

Day counts are actual calendar days over 365, the standard XIRR convention (what a
spreadsheet's XIRR function uses), not the nominal-month convention the rest of this
package uses for CAGR - a spreadsheet is the reference this metric is checked against.
"""

from __future__ import annotations

from typing import Final

import numpy as np
import pandas as pd

from ..quality import Metric, Reason

MIN_SIP_CONTRIBUTIONS: Final = 12

# -99.99% (a total loss is not quite -100%, which is a division by zero) to +2000%
# annualised. No real mutual fund cash flow needs a bracket wider than this; a series
# that only balances outside it is not one this metric should report a number for.
_RATE_LOW: Final = -0.9999
_RATE_HIGH: Final = 20.0
_BRACKET_GRID: Final = np.concatenate(
    [
        np.linspace(_RATE_LOW, 1.0, 60),
        np.linspace(1.0, _RATE_HIGH, 40)[1:],
    ]
)
_BISECT_MAX_ITER: Final = 100
_BISECT_TOL: Final = 1e-11

NOT_BRACKETED: Final = "sip_xirr_not_bracketed"

# Merged into the API's data_quality_reasons alongside the shared `quality.DESCRIPTIONS`,
# since this reason is specific to the root finder here rather than a data-sufficiency gap.
REASON_DESCRIPTIONS: Final[dict[str, str]] = {
    NOT_BRACKETED: (
        "No annualised rate between -99.99% and +2000% makes this SIP's cash flows "
        "net to zero, so no plausible XIRR exists for it. This is a bracketed solve, "
        "not a Newton guess, so a series like this reports a reason instead of a "
        "number that happened to be the nearest root a guess converged to."
    ),
}


def _npv(rate: float, days: np.ndarray, flows: np.ndarray) -> float:
    return float(np.sum(flows / np.power(1.0 + rate, days / 365.0)))


def _bracket(days: np.ndarray, flows: np.ndarray) -> tuple[float, float] | None:
    values = np.array([_npv(r, days, flows) for r in _BRACKET_GRID])
    signs = np.sign(values)
    zero_at = np.flatnonzero(signs == 0.0)
    if len(zero_at):
        r = float(_BRACKET_GRID[zero_at[0]])
        return r, r
    change = np.flatnonzero(signs[:-1] * signs[1:] < 0.0)
    if not len(change):
        return None
    i = int(change[0])
    return float(_BRACKET_GRID[i]), float(_BRACKET_GRID[i + 1])


def _solve_xirr(days: np.ndarray, flows: np.ndarray) -> float | None:
    """Bracketed bisection on NPV(rate). Never a Newton guess from a starting point."""
    bracket = _bracket(days, flows)
    if bracket is None:
        return None
    lo, hi = bracket
    if lo == hi:
        return lo
    f_lo = _npv(lo, days, flows)
    for _ in range(_BISECT_MAX_ITER):
        mid = (lo + hi) / 2.0
        f_mid = _npv(mid, days, flows)
        if abs(f_mid) < _BISECT_TOL or (hi - lo) < _BISECT_TOL:
            return mid
        if (f_mid < 0.0) == (f_lo < 0.0):
            lo, f_lo = mid, f_mid
        else:
            hi = mid
    return (lo + hi) / 2.0


def _schedule(window: pd.Series) -> tuple[np.ndarray, np.ndarray]:
    """One unit bought at each month-end NAV; the whole holding sold at the last one."""
    units = 1.0 / window.to_numpy(dtype=float)
    redemption = float(units.sum()) * float(window.iloc[-1])
    flows = -np.ones(len(window))
    flows[-1] = redemption - 1.0
    days = (pd.DatetimeIndex(window.index) - window.index[0]).days.to_numpy(dtype=float)
    return days, flows


def _window(valid: pd.Series, end_label: pd.Timestamp, years: int) -> pd.Series:
    start_bound = end_label - pd.DateOffset(years=years)
    return valid.loc[(valid.index > start_bound) & (valid.index <= end_label)]


def sip_xirr(monthly: pd.DataFrame, years: int) -> Metric:
    """SIP XIRR over the trailing `years`, anchored on the series' latest month-end.

    Uses the same month-end grid every other metric here does - `monthly` already
    starts after any NAV scale break, so a redenomination truncates this identically.
    """
    valid = monthly["nav"].dropna()
    valid = valid[valid > 0]
    if valid.empty:
        return Metric.missing(Reason.INSUFFICIENT_HISTORY)
    window = _window(valid, valid.index[-1], years)
    if len(window) < MIN_SIP_CONTRIBUTIONS:
        return Metric.missing(Reason.INSUFFICIENT_OBSERVATIONS, len(window))
    days, flows = _schedule(window)
    rate = _solve_xirr(days, flows)
    if rate is None:
        return Metric.missing(NOT_BRACKETED, len(window))
    return Metric(rate, len(window))


def rolling_sip_xirr_series(monthly: pd.DataFrame, years: int) -> pd.Series:
    """SIP XIRR ending at every month-end where a full trailing window exists."""
    valid = monthly["nav"].dropna()
    valid = valid[valid > 0]
    out: dict[pd.Timestamp, float] = {}
    for end_label in valid.index:
        window = _window(valid, end_label, years)
        if len(window) < MIN_SIP_CONTRIBUTIONS:
            continue
        days, flows = _schedule(window)
        rate = _solve_xirr(days, flows)
        if rate is not None:
            out[end_label] = rate
    return pd.Series(out, dtype="float64", index=pd.DatetimeIndex(list(out), name="date"))


def rolling_sip_xirr_median(monthly: pd.DataFrame, years: int, min_windows: int) -> Metric:
    """Median SIP XIRR across every overlapping `years`-window, gated the same as
    every other rolling summary here (`MF_MIN_ROLLING_WINDOWS`)."""
    series = rolling_sip_xirr_series(monthly, years)
    n = len(series)
    if n < min_windows:
        return Metric.missing(Reason.INSUFFICIENT_WINDOWS, n)
    return Metric(float(series.median()), n)
