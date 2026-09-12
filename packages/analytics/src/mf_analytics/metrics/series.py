"""NAV series handling: monthly resampling, monthly returns, trailing and rolling CAGR."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, cast

import numpy as np
import pandas as pd

from ..quality import Metric, Reason

MONTHS_PER_YEAR = 12
ANNUALISATION_MONTHLY = np.sqrt(12.0)


def last_scale_break(monthly_nav: pd.Series, jump_ratio: float) -> pd.Timestamp | None:
    """Month-end of the most recent NAV level shift no market move can explain.

    AMFI publishes NAVs as filed, so a face-value redenomination or unit split appears
    as a single month multiplying or dividing by 10 or 100. Compounding through one
    turns a 6% overnight fund into a 67% five-year CAGR. The returns either side of the
    break are real; only the step between them is an artefact, so callers use this to
    start the comparable history at the break rather than to patch the level.
    """
    nav = pd.to_numeric(monthly_nav, errors="coerce").dropna()
    if len(nav) < 2:
        return None
    ratio = nav / nav.shift(1)
    breaks = ratio[(ratio >= jump_ratio) | (ratio <= 1.0 / jump_ratio)]
    return cast(pd.Timestamp, breaks.index[-1]) if len(breaks) else None


def comparable_grid(
    rows: pd.DataFrame, jump_ratio: float
) -> tuple[pd.DataFrame, pd.Timestamp | None]:
    """One scheme's stored month-end rows as a gap-free grid of comparable history.

    Returns the grid and the scale break it starts at, if any. Every consumer of a
    stored NAV series goes through here, so a chart, a live comparison and the stored
    snapshot cannot disagree about which months are usable.
    """
    frame = rows.set_index(pd.DatetimeIndex(pd.to_datetime(rows["date"]), name="date"))[
        ["nav", "obs_date"]
    ].sort_index()
    grid = frame.reindex(pd.date_range(frame.index[0], frame.index[-1], freq="ME", name="date"))
    break_at = last_scale_break(grid["nav"], jump_ratio)
    return (grid if break_at is None else grid.loc[break_at:]), break_at


def to_monthly(nav_daily: pd.DataFrame, tolerance_days: int = 10) -> pd.DataFrame:
    """Last available NAV in each calendar month, on a gap-free month-end grid.

    Months with no NAV at all stay NaN: gaps are reported, never forward-filled.
    A month whose last NAV lands more than `tolerance_days` before the month end is
    not a month-end observation either - that drops the running current month, so a
    part-month is never compared against a full one. `obs_date` keeps the true
    observation date so tolerance checks downstream stay honest.
    """
    if nav_daily.empty:
        return pd.DataFrame(columns=["nav", "obs_date"], index=pd.DatetimeIndex([], name="date"))
    df = nav_daily.loc[:, ["date", "nav"]].copy()
    df["date"] = pd.to_datetime(df["date"])
    df["nav"] = pd.to_numeric(df["nav"], errors="coerce")
    df = df.dropna(subset=["nav"])
    df = df[df["nav"] > 0].sort_values("date")
    if df.empty:
        return pd.DataFrame(columns=["nav", "obs_date"], index=pd.DatetimeIndex([], name="date"))
    last = df.groupby(df["date"].dt.to_period("M")).tail(1)
    monthly = pd.DataFrame(
        {"nav": last["nav"].to_numpy(), "obs_date": last["date"].to_numpy()},
        # nanosecond unit throughout, so string label lookups behave the same everywhere
        index=pd.DatetimeIndex(
            last["date"].dt.to_period("M").dt.to_timestamp("M"), name="date"
        ).as_unit("ns"),
    )
    stale = (monthly.index - pd.DatetimeIndex(monthly["obs_date"])).days > tolerance_days
    monthly = cast(pd.DataFrame, monthly.loc[~stale])
    if monthly.empty:
        return pd.DataFrame(columns=["nav", "obs_date"], index=pd.DatetimeIndex([], name="date"))
    grid = pd.date_range(monthly.index[0], monthly.index[-1], freq="ME", name="date").as_unit("ns")
    return monthly.reindex(grid)


def monthly_returns(monthly: pd.DataFrame) -> pd.DataFrame:
    """Simple and log monthly returns on the full month-end grid.

    Gap months stay in the index as NaN on both sides, so a gap is visible rather
    than closed up by dropping rows.
    """
    nav = monthly["nav"]
    simple = nav / nav.shift(1) - 1.0
    with np.errstate(divide="ignore", invalid="ignore"):
        log = np.log(nav / nav.shift(1))
    return pd.DataFrame({"monthly_return": simple, "log_return": log})


@dataclass(frozen=True, slots=True)
class CagrResult:
    metric: Metric
    start_date: pd.Timestamp | None = None
    end_date: pd.Timestamp | None = None
    start_nav: float | None = None
    end_nav: float | None = None
    elapsed_days: int | None = None


def _nearest_within(
    monthly: pd.DataFrame, target: pd.Timestamp, tolerance_days: int
) -> pd.Timestamp | None:
    """Exact month-end label first, otherwise the nearest labelled month inside tolerance."""
    valid = pd.DatetimeIndex(monthly.index[monthly["nav"].notna()])
    if len(valid) == 0:
        return None
    if target in valid:
        return target
    deltas = np.abs((valid - target).days.to_numpy())
    i = int(np.argmin(deltas))
    return pd.Timestamp(valid[i]) if deltas[i] <= tolerance_days else None


def trailing_cagr(monthly: pd.DataFrame, years: int, tolerance_days: int = 10) -> CagrResult:
    """Annualised return over `years`, anchored on the latest month-end NAV.

    The exponent uses the nominal horizon; the tolerance bounds how far the start
    observation may drift from it, and the realised elapsed days are reported.
    """
    valid = monthly[monthly["nav"].notna()]
    if valid.empty:
        return CagrResult(Metric.missing(Reason.INSUFFICIENT_HISTORY))
    end_label = valid.index[-1]
    target = (end_label - pd.DateOffset(years=years)) + pd.offsets.MonthEnd(0)
    if target < valid.index[0] - pd.Timedelta(days=tolerance_days):
        return CagrResult(Metric.missing(Reason.INSUFFICIENT_HISTORY))
    start_label = _nearest_within(monthly, target, tolerance_days)
    if start_label is None:
        return CagrResult(Metric.missing(Reason.OUT_OF_TOLERANCE))
    start_obs = pd.Timestamp(cast(Any, valid.loc[start_label, "obs_date"]))
    end_obs = pd.Timestamp(cast(Any, valid.loc[end_label, "obs_date"]))
    if abs((start_obs - start_label).days) > tolerance_days:
        return CagrResult(Metric.missing(Reason.OUT_OF_TOLERANCE))
    start_nav = float(cast(Any, valid.loc[start_label, "nav"]))
    end_nav = float(cast(Any, valid.loc[end_label, "nav"]))
    if start_nav <= 0:
        return CagrResult(Metric.missing(Reason.ZERO_DENOMINATOR))
    n_obs = int(monthly.loc[start_label:end_label, "nav"].notna().sum())
    value = (end_nav / start_nav) ** (1.0 / years) - 1.0
    return CagrResult(
        Metric(float(value), n_obs),
        start_date=start_label,
        end_date=end_label,
        start_nav=start_nav,
        end_nav=end_nav,
        elapsed_days=int((end_obs - start_obs).days),
    )


def rolling_cagr(monthly: pd.DataFrame, years: int) -> pd.Series:
    """Series of annualised returns over every trailing `years` window ending at t."""
    nav = monthly["nav"]
    shift = MONTHS_PER_YEAR * years
    if len(nav) <= shift:
        return pd.Series(dtype="float64", index=pd.DatetimeIndex([], name="date"))
    past = nav.shift(shift)
    ratio = nav / past.where(past > 0)
    return (ratio ** (1.0 / years) - 1.0).dropna()


@dataclass(frozen=True, slots=True)
class RollingSummary:
    mean: Metric
    median: Metric
    minimum: Metric
    maximum: Metric
    std: Metric
    positive_pct: Metric
    window_count: int


def summarise_rolling(series: pd.Series, min_windows: int) -> RollingSummary:
    n = int(series.notna().sum())
    if n < min_windows:
        miss = Metric.missing(Reason.INSUFFICIENT_WINDOWS, n)
        return RollingSummary(miss, miss, miss, miss, miss, miss, n)
    s = series.dropna()
    std = (
        Metric(float(s.std(ddof=1)), n)
        if n >= 2
        else Metric.missing(Reason.INSUFFICIENT_OBSERVATIONS, n)
    )
    return RollingSummary(
        mean=Metric(float(s.mean()), n),
        median=Metric(float(s.median()), n),
        minimum=Metric(float(s.min()), n),
        maximum=Metric(float(s.max()), n),
        std=std,
        positive_pct=Metric(float((s > 0).mean()), n),
        window_count=n,
    )


def beat_pct(fund: pd.Series, comparison: pd.Series, min_windows: int) -> Metric:
    """Share of aligned rolling windows where the fund's rolling CAGR is higher."""
    aligned = pd.concat([fund.rename("f"), comparison.rename("c")], axis=1, sort=True).dropna()
    n = len(aligned)
    if n < min_windows:
        return Metric.missing(Reason.INSUFFICIENT_WINDOWS, n)
    return Metric(float((aligned["f"] > aligned["c"]).mean()), n)


def calendar_year_returns(returns: pd.Series) -> pd.DataFrame:
    """Compounded return per calendar year, with the month count behind each one.

    The first and last year of a fund's life are almost always partial. They are
    reported rather than dropped, and `months` is what says so: a 4-month 2026 is not
    comparable with a 12-month 2025 and the count is the only thing that reveals it.
    """
    r = pd.to_numeric(returns, errors="coerce").dropna()
    if r.empty:
        return pd.DataFrame(columns=["year", "fund_return", "months"])
    grouped = (1.0 + r).groupby(pd.DatetimeIndex(r.index).year)
    frame = pd.DataFrame(
        {"fund_return": grouped.prod().astype(float) - 1.0, "months": grouped.size()}
    )
    return frame.rename_axis("year").reset_index()
