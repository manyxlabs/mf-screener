"""Risk and risk-adjusted metrics on monthly return series (annualised by sqrt(12))."""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Any, cast

import numpy as np
import numpy.typing as npt
import pandas as pd

from ..quality import Metric, Reason
from .series import ANNUALISATION_MONTHLY

MIN_OBS_DEFAULT = 24
# A "constant" float series has a standard deviation around 1e-18 rather than 0.
# Anything at or below this is treated as no dispersion at all, so a metric is
# reported as undefined instead of as an enormous ratio.
ZERO_TOLERANCE = 1e-12


def _clean(series: pd.Series) -> pd.Series:
    return pd.to_numeric(series, errors="coerce").dropna()


def volatility(returns: pd.Series, min_obs: int = MIN_OBS_DEFAULT) -> Metric:
    r = _clean(returns)
    if len(r) < min_obs:
        return Metric.missing(Reason.INSUFFICIENT_OBSERVATIONS, len(r))
    return Metric(float(r.std(ddof=1) * ANNUALISATION_MONTHLY), len(r))


def sharpe(returns: pd.Series, rf_monthly: float, min_obs: int = MIN_OBS_DEFAULT) -> Metric:
    r = _clean(returns)
    if len(r) < min_obs:
        return Metric.missing(Reason.INSUFFICIENT_OBSERVATIONS, len(r))
    sd = float(r.std(ddof=1))
    if sd <= ZERO_TOLERANCE:
        return Metric.missing(Reason.ZERO_DENOMINATOR, len(r))
    return Metric(float((r - rf_monthly).mean() / sd * ANNUALISATION_MONTHLY), len(r))


def downside_deviation(
    returns: pd.Series, threshold: float, min_obs: int = MIN_OBS_DEFAULT
) -> Metric:
    """Annualised deviation of shortfalls below `threshold`.

    Only below-threshold months contribute to the sum, but the denominator is the
    full sample. Dividing by the count of down months instead would put this on a
    different scale from volatility, and the two are read side by side.
    """
    r = _clean(returns)
    if len(r) < min_obs:
        return Metric.missing(Reason.INSUFFICIENT_OBSERVATIONS, len(r))
    below = r[r < threshold] - threshold
    if len(below) < 2:
        return Metric.missing(Reason.NO_DOWNSIDE, len(below))
    dd = float(np.sqrt((below**2).sum() / (len(r) - 1)))
    return Metric(dd * float(ANNUALISATION_MONTHLY), len(r))


def sortino(returns: pd.Series, rf_monthly: float, min_obs: int = MIN_OBS_DEFAULT) -> Metric:
    r = _clean(returns)
    if len(r) < min_obs:
        return Metric.missing(Reason.INSUFFICIENT_OBSERVATIONS, len(r))
    dd = downside_deviation(r, rf_monthly, min_obs)
    if dd.value is None:
        return Metric.missing(dd.reason or Reason.NO_DOWNSIDE, dd.n_obs)
    monthly_dd = dd.value / float(ANNUALISATION_MONTHLY)
    if monthly_dd <= ZERO_TOLERANCE:
        return Metric.missing(Reason.ZERO_DENOMINATOR, len(r))
    return Metric(float((r - rf_monthly).mean() / monthly_dd * ANNUALISATION_MONTHLY), len(r))


def _align(fund: pd.Series, comparison: pd.Series) -> pd.DataFrame:
    return pd.concat(
        [_clean(fund).rename("f"), _clean(comparison).rename("c")], axis=1, sort=True
    ).dropna()


def tracking_error(
    fund: pd.Series, comparison: pd.Series, min_obs: int = MIN_OBS_DEFAULT
) -> Metric:
    a = _align(fund, comparison)
    if len(a) < min_obs:
        return Metric.missing(Reason.NO_OVERLAP, len(a))
    return Metric(float((a["f"] - a["c"]).std(ddof=1) * ANNUALISATION_MONTHLY), len(a))


def information_ratio(
    fund: pd.Series, comparison: pd.Series, min_obs: int = MIN_OBS_DEFAULT
) -> Metric:
    a = _align(fund, comparison)
    if len(a) < min_obs:
        return Metric.missing(Reason.NO_OVERLAP, len(a))
    active = a["f"] - a["c"]
    sd = float(active.std(ddof=1))
    if sd <= ZERO_TOLERANCE:
        return Metric.missing(Reason.ZERO_DENOMINATOR, len(a))
    return Metric(float(active.mean() / sd * ANNUALISATION_MONTHLY), len(a))


@dataclass(frozen=True, slots=True)
class Regression:
    alpha: Metric
    beta: Metric
    r_squared: Metric
    alpha_tstat: Metric
    alpha_pvalue: Metric


def _betacf(a: float, b: float, x: float) -> float:
    """Continued-fraction factor of the incomplete beta function (Numerical Recipes)."""
    tiny = 1e-300
    qab, qap, qam = a + b, a + 1.0, a - 1.0
    c = 1.0
    d = 1.0 - qab * x / qap
    d = tiny if abs(d) < tiny else d
    d = 1.0 / d
    h = d
    for m in range(1, 200):
        m2 = 2 * m
        aa = m * (b - m) * x / ((qam + m2) * (a + m2))
        d = 1.0 + aa * d
        d = tiny if abs(d) < tiny else d
        c = 1.0 + aa / c
        c = tiny if abs(c) < tiny else c
        d = 1.0 / d
        h *= d * c
        aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2))
        d = 1.0 + aa * d
        d = tiny if abs(d) < tiny else d
        c = 1.0 + aa / c
        c = tiny if abs(c) < tiny else c
        d = 1.0 / d
        delta = d * c
        h *= delta
        if abs(delta - 1.0) < 1e-14:
            break
    return h


def _regularized_incomplete_beta(a: float, b: float, x: float) -> float:
    if x <= 0.0:
        return 0.0
    if x >= 1.0:
        return 1.0
    ln_front = math.lgamma(a + b) - math.lgamma(a) - math.lgamma(b)
    ln_front += a * math.log(x) + b * math.log(1.0 - x)
    front = math.exp(ln_front)
    if x < (a + 1.0) / (a + b + 2.0):
        return front * _betacf(a, b, x) / a
    return 1.0 - front * _betacf(b, a, 1.0 - x) / b


def _t_two_sided_pvalue(t_stat: float, df: int) -> float:
    """P(|T| > |t_stat|) for Student's t with `df` degrees of freedom.

    No scipy dependency here, so this is the standard identity
    P(|T| > t) = I_x(df/2, 1/2) with x = df / (df + t^2), evaluated via the
    regularised incomplete beta function's continued-fraction expansion.
    """
    x = df / (df + t_stat * t_stat)
    return _regularized_incomplete_beta(df / 2.0, 0.5, x)


def alpha_beta(
    fund: pd.Series, benchmark: pd.Series, rf_monthly: float, min_obs: int = MIN_OBS_DEFAULT
) -> Regression:
    """OLS of fund excess return on benchmark excess return; alpha annualised.

    `alpha_tstat`/`alpha_pvalue` test the *monthly* intercept against zero -
    annualising it first would test a nonlinear transform of the estimate instead
    of the estimate itself. Screened across thousands of schemes, an unadjusted
    p-value below 0.05 is expected by chance alone for roughly 5% of them; callers
    must surface that rather than treat a low p-value as proof of skill.
    """
    a = _align(fund, benchmark)
    n = len(a)
    if n < min_obs:
        miss = Metric.missing(Reason.NO_OVERLAP, n)
        return Regression(miss, miss, miss, miss, miss)
    y = (a["f"] - rf_monthly).to_numpy(dtype=float)
    x = (a["c"] - rf_monthly).to_numpy(dtype=float)
    if float(np.std(x, ddof=1)) <= ZERO_TOLERANCE:
        miss = Metric.missing(Reason.ZERO_DENOMINATOR, n)
        return Regression(miss, miss, miss, miss, miss)
    design = np.column_stack([np.ones_like(x), x])
    coef, *_ = np.linalg.lstsq(design, y, rcond=None)
    intercept, slope = float(coef[0]), float(coef[1])
    resid = y - design @ coef
    ss_tot = float(((y - y.mean()) ** 2).sum())
    r2 = 1.0 - float((resid**2).sum()) / ss_tot if ss_tot > 0 else None

    dof = n - 2
    ssr = float((resid**2).sum())
    xbar = float(x.mean())
    sxx = float(((x - xbar) ** 2).sum())
    if dof > 0 and ssr > ZERO_TOLERANCE and sxx > ZERO_TOLERANCE:
        sigma2 = ssr / dof
        se_intercept = float(np.sqrt(sigma2 * (1.0 / n + xbar**2 / sxx)))
        t_stat = intercept / se_intercept
        tstat_metric = Metric(t_stat, n)
        pvalue_metric = Metric(_t_two_sided_pvalue(t_stat, dof), n)
    else:
        # A residual-free fit leaves no variance to estimate a standard error from.
        tstat_metric = Metric.missing(Reason.ZERO_DENOMINATOR, n)
        pvalue_metric = Metric.missing(Reason.ZERO_DENOMINATOR, n)

    return Regression(
        alpha=Metric((1.0 + intercept) ** 12 - 1.0, n),
        beta=Metric(slope, n),
        r_squared=Metric(r2, n) if r2 is not None else Metric.missing(Reason.ZERO_DENOMINATOR, n),
        alpha_tstat=tstat_metric,
        alpha_pvalue=pvalue_metric,
    )


@dataclass(frozen=True, slots=True)
class Drawdown:
    metric: Metric
    peak_date: pd.Timestamp | None = None
    trough_date: pd.Timestamp | None = None


def max_drawdown(nav: pd.Series, min_obs: int = 2) -> Drawdown:
    """Worst peak-to-trough decline of a NAV series.

    The pipeline computes this over the daily lake in SQL rather than calling this,
    because the full history will not fit in pandas. `DRAWDOWN_SQL` is the same
    definition expressed as a window function, and a test holds the two to the same
    answer on the same series.
    """
    s = _clean(nav).sort_index()
    if len(s) < min_obs:
        return Drawdown(Metric.missing(Reason.INSUFFICIENT_OBSERVATIONS, len(s)))
    running_max = s.cummax()
    dd = s / running_max - 1.0
    trough = pd.Timestamp(cast(Any, dd.idxmin()))
    peak = pd.Timestamp(cast(Any, s.loc[:trough].idxmax()))
    return Drawdown(Metric(float(dd.min()), len(s)), peak_date=peak, trough_date=trough)


def calmar(cagr: Metric, mdd: Metric) -> Metric:
    if cagr.value is None:
        return Metric.missing(cagr.reason or Reason.INSUFFICIENT_HISTORY, cagr.n_obs)
    if mdd.value is None:
        return Metric.missing(mdd.reason or Reason.INSUFFICIENT_OBSERVATIONS, mdd.n_obs)
    if mdd.value == 0.0:
        return Metric.missing(Reason.ZERO_DENOMINATOR, mdd.n_obs)
    return Metric(cagr.value / abs(mdd.value), min(cagr.n_obs, mdd.n_obs))


@dataclass(frozen=True, slots=True)
class DrawdownEpisode:
    """One completed or still-open fall from a NAV high."""

    peak_date: pd.Timestamp
    trough_date: pd.Timestamp
    depth: float
    recovered_date: pd.Timestamp | None
    days_to_trough: int
    days_to_recover: int | None


def drawdown_episodes(
    nav: pd.Series, min_depth: float = 0.10, limit: int = 5
) -> list[DrawdownEpisode]:
    """The worst distinct falls from a high, each with how long it took to come back.

    `max_drawdown` answers how far the fund fell once. This answers the question an
    investor actually asks next: how often did that happen, and how long was I under
    water. An episode runs from a high to the moment that high is regained, so the
    2020 and 2022 falls are two episodes rather than one long one.

    `depth` is negative. The last episode is open when the fund has never regained its
    peak, and carries `recovered_date` None rather than being dropped: an unrecovered
    fall is the most important one on the list.
    """
    s = _clean(nav).sort_index()
    if len(s) < 2:
        return []
    values = s.to_numpy(dtype=float)
    dates = pd.DatetimeIndex(s.index)

    episodes: list[DrawdownEpisode] = []
    peak_index = 0
    trough_index: int | None = None
    for i in range(1, len(values)):
        if values[i] >= values[peak_index]:
            if trough_index is not None:
                episodes.append(_episode(dates, values, peak_index, trough_index, i))
                trough_index = None
            peak_index = i
        elif trough_index is None or values[i] < values[trough_index]:
            trough_index = i
    if trough_index is not None:
        episodes.append(_episode(dates, values, peak_index, trough_index, None))

    deep = [e for e in episodes if e.depth <= -abs(min_depth)]
    return sorted(deep, key=lambda e: e.depth)[:limit]


def _episode(
    dates: pd.DatetimeIndex,
    values: npt.NDArray[np.float64],
    peak: int,
    trough: int,
    recovered: int | None,
) -> DrawdownEpisode:
    peak_date = dates[peak]
    trough_date = dates[trough]
    recovered_date = dates[recovered] if recovered is not None else None
    return DrawdownEpisode(
        peak_date=peak_date,
        trough_date=trough_date,
        depth=float(values[trough] / values[peak]) - 1.0,
        recovered_date=recovered_date,
        days_to_trough=int((trough_date - peak_date).days),
        days_to_recover=None if recovered_date is None else int((recovered_date - peak_date).days),
    )


@dataclass(frozen=True, slots=True)
class Capture:
    """How much of the comparison's rise and fall the fund took part in."""

    up: Metric
    down: Metric


def capture_ratios(
    fund: pd.Series, comparison: pd.Series, min_obs: int = MIN_OBS_DEFAULT
) -> Capture:
    """Cumulative up- and down-capture against a comparison return series.

    Each is the fund's compounded return over the months the comparison rose (or fell),
    divided by the comparison's own compounded return over those same months. Above 1
    on the up side means the fund gained more than its peers when they gained; below 1
    on the down side means it lost less when they lost, which is the desirable direction.
    """
    paired = _align(fund, comparison)
    if len(paired) < min_obs:
        return Capture(
            Metric.missing(Reason.INSUFFICIENT_OBSERVATIONS, len(paired)),
            Metric.missing(Reason.INSUFFICIENT_OBSERVATIONS, len(paired)),
        )
    return Capture(_capture(paired[paired["c"] > 0]), _capture(paired[paired["c"] < 0]))


def _capture(months: pd.DataFrame) -> Metric:
    if months.empty:
        return Metric.missing(Reason.NO_OVERLAP, 0)
    comparison = float(np.prod(1.0 + months["c"].to_numpy(dtype=float))) - 1.0
    if abs(comparison) <= ZERO_TOLERANCE:
        return Metric.missing(Reason.ZERO_DENOMINATOR, len(months))
    fund = float(np.prod(1.0 + months["f"].to_numpy(dtype=float))) - 1.0
    return Metric(fund / comparison, len(months))
