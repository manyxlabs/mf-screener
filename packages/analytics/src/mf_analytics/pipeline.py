"""Metric generation: builds category series, then one snapshot row per scheme."""

from __future__ import annotations

import json
from collections.abc import Iterator, Mapping
from concurrent.futures import ProcessPoolExecutor
from dataclasses import dataclass
from datetime import UTC, datetime
from multiprocessing import get_context
from typing import Any, Final, cast

import numpy as np
import pandas as pd

from . import classify
from .config import (
    BASE_CURRENCY,
    HORIZONS,
    ROLLING_HORIZONS,
    TRAILING_HORIZONS,
    Settings,
    get_settings,
)
from .db import connect, init_schema, record_ingest
from .ingest.benchmarks import STYLE_FACTOR_CLASS
from .ingest.nav import register_nav_view
from .logging_setup import get_logger, log_event
from .metrics import cashflow, persistence, relative, risk
from .metrics.exposure import rolling_style_exposure, style_drift
from .metrics.series import (
    beat_pct,
    calendar_year_returns,
    comparable_grid,
    rolling_cagr,
    summarise_rolling,
    trailing_cagr,
)
from .metrics.series import monthly_returns as compute_monthly_returns
from .quality import Metric, Reason
from .scoring import score_fund
from .universe import DEFAULT_UNIVERSE, PeerUniverse

logger = get_logger(__name__)

# Minimum matched monthly observations before a risk metric is computed, per horizon.
MIN_RISK_OBS: dict[int, int] = {1: 10, 3: 24, 5: 42, 10: 84}

# Horizons capture ratios are stored at. Matches the "3y"/"5y" convention every other
# peer-relative column in this file uses; 1y and 10y add little a screener sorts on.
CAPTURE_HORIZONS: tuple[int, ...] = (3, 5)

# Fewer complete years than this and "worst year" or "% positive years" is one or two
# data points dressed up as a statistic, not a measurement.
MIN_CALENDAR_YEARS: int = 3

# A reason this file's own new columns can be null for, kept local rather than added to
# `quality.Reason` and merged into the methodology document's reason catalogue - the same
# way `metrics/cashflow.py` keeps its SIP-XIRR-specific reason.
NOT_RECOVERED = "not_recovered"
# `Reason.INSUFFICIENT_HISTORY` describes a shortage of NAV history, which is the wrong
# dimension here and told the reader to go and wait for NAVs this fund already has.
INSUFFICIENT_AUM_HISTORY = "insufficient_aum_history"
REASON_DESCRIPTIONS: dict[str, str] = {
    INSUFFICIENT_AUM_HISTORY: (
        "Fewer than five dated quarterly AUM readings are stored for this scheme, so a "
        "four-quarter change has nothing to measure from. AUM history accrues one "
        "quarter per master ingest and is never backfilled, so this fills in over time "
        "rather than being a fact about the fund."
    ),
    NOT_RECOVERED: (
        "The fund has not regained the NAV high it fell from inside this window, so "
        "there is no recovery date to measure days against. A large placeholder number "
        "would misstate a fall the fund may still be inside."
    ),
}

# Columns this task adds to a snapshot table that may already exist on disk from a
# build made before this change. Additive `ALTER TABLE` keeps an existing store usable
# without a destructive migration, the same pattern `db.py` uses for every other column
# this project has added to `scheme_metrics_snapshot` since its first release.
BEHAVIOUR_SNAPSHOT_COLUMNS: dict[str, str] = {
    **{f"upside_capture_{h}y": "DOUBLE" for h in CAPTURE_HORIZONS},
    **{f"downside_capture_{h}y": "DOUBLE" for h in CAPTURE_HORIZONS},
    "max_drawdown_5y_recovery_days": "INTEGER",
    "worst_calendar_year_return": "DOUBLE",
    "worst_calendar_year": "INTEGER",
    "positive_calendar_years_pct": "DOUBLE",
}


def ensure_behaviour_columns(con: Any) -> None:
    for name, kind in BEHAVIOUR_SNAPSHOT_COLUMNS.items():
        con.execute(f"ALTER TABLE scheme_metrics_snapshot ADD COLUMN IF NOT EXISTS {name} {kind}")


# The score's momentum component, added the same additive way as BEHAVIOUR_SNAPSHOT_COLUMNS.
MOMENTUM_SNAPSHOT_COLUMNS: dict[str, str] = {"momentum_12_1": "DOUBLE"}
# Eleven months is the whole window, so anything short of it is a different window, not
# a thinner one. A fund with ten months of history has no 12-1 momentum, it has ten months.
MOMENTUM_MIN_MONTHS: Final[int] = 11


def ensure_momentum_columns(con: Any) -> None:
    for name, kind in MOMENTUM_SNAPSHOT_COLUMNS.items():
        con.execute(f"ALTER TABLE scheme_metrics_snapshot ADD COLUMN IF NOT EXISTS {name} {kind}")


# T1.4's quartile-persistence columns, added the same additive way as BEHAVIOUR_SNAPSHOT_COLUMNS.
PERSISTENCE_SNAPSHOT_COLUMNS: dict[str, str] = {
    "quartile_now_3y": "INTEGER",
    "quartile_now_5y": "INTEGER",
    "quartile_persistence_3y": "DOUBLE",
    "quartile_top_share_3y": "DOUBLE",
    "quartile_transitions_3y": "INTEGER",
}


def ensure_persistence_columns(con: Any) -> None:
    for name, kind in PERSISTENCE_SNAPSHOT_COLUMNS.items():
        con.execute(f"ALTER TABLE scheme_metrics_snapshot ADD COLUMN IF NOT EXISTS {name} {kind}")


# T1.5's style-drift column, added the same additive way as BEHAVIOUR_SNAPSHOT_COLUMNS.
EXPOSURE_SNAPSHOT_COLUMNS: dict[str, str] = {"style_drift_3y": "DOUBLE"}


def ensure_exposure_columns(con: Any) -> None:
    for name, kind in EXPOSURE_SNAPSHOT_COLUMNS.items():
        con.execute(f"ALTER TABLE scheme_metrics_snapshot ADD COLUMN IF NOT EXISTS {name} {kind}")


# T1.7's alpha-significance columns, added the same additive way as BEHAVIOUR_SNAPSHOT_COLUMNS.
ALPHA_SIGNIFICANCE_SNAPSHOT_COLUMNS: dict[str, str] = {
    **{f"alpha_tstat_{h}y": "DOUBLE" for h in HORIZONS},
    **{f"alpha_pvalue_{h}y": "DOUBLE" for h in HORIZONS},
}


def ensure_alpha_significance_columns(con: Any) -> None:
    for name, kind in ALPHA_SIGNIFICANCE_SNAPSHOT_COLUMNS.items():
        con.execute(f"ALTER TABLE scheme_metrics_snapshot ADD COLUMN IF NOT EXISTS {name} {kind}")


# --- T2.3: AUM history-derived snapshot columns, added the same additive way as
# BEHAVIOUR_SNAPSHOT_COLUMNS. Screening and display columns: the composite score no
# longer prices fund size, so nothing downstream breaks if one of them is null.
AUM_SNAPSHOT_COLUMNS: dict[str, str] = {
    "aum_family_latest": "DOUBLE",
    "aum_growth_4q": "DOUBLE",
    "aum_percentile_in_sub_category": "DOUBLE",
}

# scheme_aum_history needs this many distinct dated quarterly readings - the horizon
# plus one to have a value to grow from - before aum_growth_4q is measured at all.
AUM_GROWTH_LOOKBACK_QUARTERS: int = 4


def ensure_aum_columns(con: Any) -> None:
    for name, kind in AUM_SNAPSHOT_COLUMNS.items():
        con.execute(f"ALTER TABLE scheme_metrics_snapshot ADD COLUMN IF NOT EXISTS {name} {kind}")


def compute_aum_family_latest(master: pd.DataFrame) -> pd.Series:
    """Sum of latest_aum across every scheme code sharing a fund_family_id.

    This is the figure comparable to a factsheet's fund-wide AUM, unlike latest_aum
    itself which is one plan+option variant. A family with no reported AUM on any
    variant sums to NaN rather than zero, so an all-missing family reads as unknown.
    """
    totals = master.groupby("fund_family_id")["latest_aum"].sum(min_count=1)
    return master["fund_family_id"].map(totals)


def compute_aum_percentile_in_sub_category(master: pd.DataFrame, min_peers: int) -> pd.Series:
    """Percentile rank of `aum_family_latest` within `clean_sub_category`, 1.0 = largest.

    Ranked one entry per fund family, not per scheme code: a family with a Direct and
    a Regular row would otherwise occupy two ranks with the same total, inflating its
    own percentile and shrinking the peer count against thinner sub-categories. Below
    `min_peers` eligible families the sub-category is withheld entirely, the same
    floor every other cross-sectional percentile here uses.
    """
    family_aum = compute_aum_family_latest(master)
    by_family = pd.DataFrame(
        {
            "fund_family_id": master["fund_family_id"],
            "clean_sub_category": master["clean_sub_category"],
            "aum": family_aum,
        }
    ).drop_duplicates(subset=["fund_family_id", "clean_sub_category"])

    # Grouped by hand rather than groupby(...).transform(udf): a sub-category with
    # every family's aum null is an all-NaN group, and transform with a callable
    # drops such groups instead of returning NaN for them, misaligning the result.
    pct_by_family: dict[Any, float] = {}
    for _, group in by_family.groupby("clean_sub_category", dropna=False):
        eligible = group["aum"].notna()
        if int(eligible.sum()) < min_peers:
            continue
        ranked = group.loc[eligible, "aum"].rank(pct=True)
        pct_by_family.update(zip(group.loc[eligible, "fund_family_id"], ranked, strict=True))

    return master["fund_family_id"].map(pct_by_family)


def compute_aum_growth(
    con: Any, lookback_quarters: int = AUM_GROWTH_LOOKBACK_QUARTERS
) -> dict[str, float]:
    """(latest AUM / AUM `lookback_quarters` ago) - 1, per scheme code.

    Ordered by aum_date rather than parsed from aum_quarter's free-text label, since
    the label's format is AMFI's to change. A scheme with fewer than
    lookback_quarters + 1 distinct dated readings is withheld rather than measured
    over a shorter window than asked for.
    """
    history = con.execute(
        "SELECT scheme_code, aum_date, latest_aum FROM scheme_aum_history "
        "WHERE latest_aum IS NOT NULL AND aum_date IS NOT NULL "
        "ORDER BY scheme_code, aum_date"
    ).fetch_df()
    growth: dict[str, float] = {}
    for code, group in history.groupby("scheme_code"):
        if len(group) < lookback_quarters + 1:
            continue
        past = float(group["latest_aum"].iloc[-(lookback_quarters + 1)])
        latest = float(group["latest_aum"].iloc[-1])
        if past:
            growth[str(code)] = (latest / past) - 1.0
    return growth


@dataclass(slots=True)
class SchemeSeries:
    monthly: pd.DataFrame  # month-end grid: nav, obs_date
    returns: pd.Series  # monthly simple returns
    # Set when the raw series changed scale; `monthly` then starts at that month.
    scale_break_at: pd.Timestamp | None = None


def load_series(con: Any, jump_ratio: float) -> dict[str, SchemeSeries]:
    """Month-end grids per scheme, each starting after any NAV scale break it contains.

    Truncating rather than rescaling keeps every published NAV as filed. The months
    before a redenomination are real, but they are denominated in different units, so
    they are not comparable with what follows and are excluded from every metric. A
    scheme whose remaining history is too short simply returns nulls, which is the
    correct answer rather than a compounded artefact.
    """
    monthly = con.execute(
        "SELECT scheme_code, date, nav, obs_date FROM nav_monthly ORDER BY scheme_code, date"
    ).fetch_df()
    out: dict[str, SchemeSeries] = {}
    for code, rows in monthly.groupby("scheme_code", sort=False):
        if len(rows) < 2:
            continue
        grid, the_break = comparable_grid(rows, jump_ratio)
        if the_break is not None:
            log_event(logger, "nav.scale_break", scheme_code=str(code), at=str(the_break.date()))
        out[str(code)] = SchemeSeries(
            monthly=grid,
            returns=compute_monthly_returns(grid)["monthly_return"],
            scale_break_at=the_break,
        )
    return out


# Drawdown is the one metric that measures the path rather than the endpoints, so
# sampling twelve points a year loses exactly what it is trying to capture: a month-end
# grid steps straight over the March 2020 bottom and understates a typical equity fund's
# worst fall by around 10 percentage points. This runs over the daily lake in DuckDB
# instead - a running peak per scheme, aggregated to one row each, so 37M rows are
# streamed and never materialised in pandas.
DRAWDOWN_SQL = """
WITH d AS (
    SELECT n.scheme_code, n.date, n.nav
    FROM nav_daily n JOIN scheme_window s USING (scheme_code)
    WHERE n.date >= s.start_date AND n.date > $window_start AND n.date <= $as_of
),
r AS (
    SELECT scheme_code, date, nav,
           max(nav)           OVER w AS peak,
           arg_max(date, nav) OVER w AS peak_date
    FROM d
    WINDOW w AS (PARTITION BY scheme_code ORDER BY date
                 ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)
)
SELECT scheme_code,
       count(*)                           AS n_obs,
       min(nav / peak - 1)                AS drawdown,
       arg_min(peak_date, nav / peak - 1) AS peak_date,
       arg_min(date, nav / peak - 1)      AS trough_date
FROM r
GROUP BY scheme_code
"""

# Far enough back to be no constraint for a scheme with no scale break.
NO_SCALE_BREAK = pd.Timestamp("1900-01-01")

# The trough DRAWDOWN_SQL already finds is "the" worst episode; this only asks, for
# that same trough and its running peak, when NAV first got back to that peak. It is
# not a second definition of a drawdown, so it does not risk disagreeing with
# `max_drawdown_5y` about which fall is the worst one.
DRAWDOWN_RECOVERY_SQL = """
WITH d AS (
    SELECT n.scheme_code, n.date, n.nav
    FROM nav_daily n JOIN scheme_window s USING (scheme_code)
    WHERE n.date >= s.start_date AND n.date > $window_start AND n.date <= $as_of
),
r AS (
    SELECT scheme_code, date, nav, max(nav) OVER w AS peak
    FROM d
    WINDOW w AS (PARTITION BY scheme_code ORDER BY date
                 ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)
),
worst AS (
    SELECT scheme_code,
           arg_min(date, nav / peak - 1) AS trough_date,
           arg_min(peak, nav / peak - 1) AS peak_at_trough
    FROM r
    GROUP BY scheme_code
)
SELECT w.scheme_code, w.trough_date,
       min(r.date) AS recovered_date
FROM worst w
LEFT JOIN r ON r.scheme_code = w.scheme_code
    AND r.date > w.trough_date AND r.nav >= w.peak_at_trough
GROUP BY w.scheme_code, w.trough_date
"""


def daily_drawdown_recovery(
    con: Any, series: Mapping[str, SchemeSeries], as_of: pd.Timestamp, years: int = 5
) -> dict[str, pd.Timestamp | None]:
    """First date each scheme's worst `years`-year drawdown regained its pre-fall peak.

    None when it never has by `as_of` - the honest answer, never a placeholder day count.
    """
    window = pd.DataFrame(
        {
            "scheme_code": list(series),
            "start_date": [s.scale_break_at or NO_SCALE_BREAK for s in series.values()],
        }
    )
    con.register("scheme_window", window)
    try:
        rows = con.execute(
            DRAWDOWN_RECOVERY_SQL,
            {
                "window_start": (as_of - pd.DateOffset(years=years)).date(),
                "as_of": as_of.date(),
            },
        ).fetch_df()
    finally:
        con.unregister("scheme_window")
    return {
        str(r["scheme_code"]): (
            None if pd.isna(r["recovered_date"]) else pd.Timestamp(r["recovered_date"])
        )
        for r in rows.to_dict("records")
    }


def daily_drawdowns(
    con: Any, series: Mapping[str, SchemeSeries], as_of: pd.Timestamp
) -> dict[int, dict[str, risk.Drawdown]]:
    """Worst peak-to-trough fall per scheme per horizon, measured on daily NAV.

    A scheme whose NAV was redenominated starts at the break, exactly as its month-end
    grid does. Without that the step itself would register as a 90% crash.
    """
    window = pd.DataFrame(
        {
            "scheme_code": list(series),
            "start_date": [s.scale_break_at or NO_SCALE_BREAK for s in series.values()],
        }
    )
    con.register("scheme_window", window)
    out: dict[int, dict[str, risk.Drawdown]] = {}
    try:
        for h in HORIZONS:
            rows = con.execute(
                DRAWDOWN_SQL,
                {
                    "window_start": (as_of - pd.DateOffset(years=h)).date(),
                    "as_of": as_of.date(),
                },
            ).fetch_df()
            out[h] = {
                str(r["scheme_code"]): risk.Drawdown(
                    Metric(float(r["drawdown"]), int(r["n_obs"])),
                    peak_date=pd.Timestamp(r["peak_date"]),
                    trough_date=pd.Timestamp(r["trough_date"]),
                )
                for r in rows.to_dict("records")
                if pd.notna(r["drawdown"])
            }
            log_event(logger, "drawdown.computed", horizon_years=h, schemes=len(out[h]))
    finally:
        con.unregister("scheme_window")
    return out


def _window(series: pd.Series, as_of: pd.Timestamp, years: int) -> pd.Series:
    start = as_of - pd.DateOffset(years=years)
    return series[(series.index > start) & (series.index <= as_of)].dropna()


def _calendar_year_flags(returns: pd.Series, min_years: int) -> dict[str, Any]:
    """Worst complete calendar year and the share of complete years spent positive.

    A partial year - the fund's first or last, almost always - is not comparable with
    a full one, so `calendar_year_returns`'s own `months` column filters it out here
    rather than letting a 2-month year masquerade as the worst one on record.
    """
    years = calendar_year_returns(returns)
    complete = years[years["months"] == 12]
    if len(complete) < min_years:
        miss = Metric.missing(Reason.INSUFFICIENT_HISTORY, len(complete))
        return {
            "worst_calendar_year_return": miss,
            "worst_calendar_year": None,
            "positive_calendar_years_pct": miss,
        }
    worst = complete.loc[complete["fund_return"].idxmin()]
    return {
        "worst_calendar_year_return": Metric(float(cast(Any, worst["fund_return"])), len(complete)),
        "worst_calendar_year": int(cast(Any, worst["year"])),
        "positive_calendar_years_pct": Metric(
            float((complete["fund_return"] > 0).mean()), len(complete)
        ),
    }


def _index_from_returns(returns: pd.Series) -> pd.DataFrame:
    """Compound a monthly return series into a NAV-like index for CAGR maths."""
    r = returns.dropna().sort_index()
    if r.empty:
        return pd.DataFrame(columns=["nav", "obs_date"], index=pd.DatetimeIndex([], name="date"))
    idx = (1.0 + r).cumprod() * 100.0
    first = r.index[0] - pd.offsets.MonthEnd(1)
    level = pd.concat([pd.Series([100.0], index=[first]), idx])
    level.index = pd.DatetimeIndex(level.index, name="date")
    return pd.DataFrame({"nav": level, "obs_date": level.index})


@dataclass(slots=True)
class CategoryContext:
    """Everything peer-relative, precomputed once per category key."""

    key: str
    label: str
    members: list[str]
    returns_wide: pd.DataFrame  # month-end x scheme
    equal_weighted: pd.Series
    median_weighted: pd.Series
    eligible_counts: pd.Series
    index_frame: pd.DataFrame
    rolling: dict[int, pd.Series]
    trailing: dict[int, Metric]
    cagr_by_scheme: dict[int, dict[str, float]]
    # Median month at which this cohort's members start. A scheme starting far after it
    # is young relative to its peers, which is the merger/rebrand hint.
    median_start: pd.Timestamp

    def ex_self_returns(self, scheme_code: str) -> pd.Series:
        """Leave-one-out equal-weighted category return for one member."""
        if scheme_code not in self.returns_wide.columns:
            return self.equal_weighted
        total = self.returns_wide.sum(axis=1, min_count=1)
        count = self.returns_wide.notna().sum(axis=1)
        own = self.returns_wide[scheme_code]
        adj_total = total - own.fillna(0.0)
        adj_count = count - own.notna().astype(int)
        return (adj_total / adj_count.where(adj_count > 0)).dropna()


def build_category_contexts(
    master: pd.DataFrame,
    series: Mapping[str, SchemeSeries],
    universe: PeerUniverse,
    as_of: pd.Timestamp,
    settings: Settings,
) -> dict[str, CategoryContext]:
    eligible = universe.filter(master)
    label_col = universe.label_column()
    contexts: dict[str, CategoryContext] = {}
    for label, group in eligible.groupby(label_col, sort=False):
        members = [c for c in group["scheme_code"].astype(str) if c in series]
        if len(members) < 2:
            continue
        wide = pd.DataFrame({c: series[c].returns for c in members}).sort_index()
        equal = relative.category_monthly_return(
            {c: series[c].returns for c in members}, aggregation="mean"
        )
        median = relative.category_monthly_return(
            {c: series[c].returns for c in members}, aggregation="median"
        )
        chosen = median if universe.aggregation == "median" else equal
        index_frame = _index_from_returns(chosen)
        rolling = {h: rolling_cagr(index_frame, h) for h in ROLLING_HORIZONS}
        trailing = {
            h: trailing_cagr(index_frame, h, settings.mf_month_end_tolerance_days).metric
            for h in TRAILING_HORIZONS
        }
        cagr_by_scheme: dict[int, dict[str, float]] = {}
        for h in TRAILING_HORIZONS:
            values: dict[str, float] = {}
            for c in members:
                res = trailing_cagr(series[c].monthly, h, settings.mf_month_end_tolerance_days)
                if res.metric.value is not None:
                    values[c] = res.metric.value
            cagr_by_scheme[h] = values
        key = universe.category_key(str(label))
        contexts[key] = CategoryContext(
            key=key,
            label=str(label),
            members=members,
            returns_wide=wide,
            equal_weighted=equal,
            median_weighted=median,
            eligible_counts=relative.eligible_counts({c: series[c].returns for c in members}),
            median_start=pd.Timestamp(
                pd.Series([series[c].monthly.index[0] for c in members]).median()
            ),
            index_frame=index_frame,
            rolling=rolling,
            trailing=trailing,
            cagr_by_scheme=cagr_by_scheme,
        )
    log_event(logger, "categories.built", count=len(contexts), universe=universe.category_key("*"))
    return contexts


def load_benchmarks(
    con: Any,
) -> tuple[dict[str, pd.Series], dict[str, pd.DataFrame], dict[str, str]]:
    rows = con.execute(
        "SELECT benchmark_id, date, price_or_total_return_index, monthly_return, currency "
        "FROM benchmarks ORDER BY benchmark_id, date"
    ).fetch_df()
    returns: dict[str, pd.Series] = {}
    frames: dict[str, pd.DataFrame] = {}
    currency: dict[str, str] = {}
    for bid, group in rows.groupby("benchmark_id", sort=False):
        codes = set(group["currency"].astype(str))
        if len(codes) > 1:
            # The CSV validator rejects this, so reaching it means the table was written
            # by something else. Guessing a currency here is how FX noise becomes alpha.
            raise RuntimeError(f"Benchmark {bid!r} has rows in more than one currency: {codes}")
        idx = pd.DatetimeIndex(pd.to_datetime(group["date"]), name="date")
        returns[str(bid)] = pd.Series(group["monthly_return"].to_numpy(), index=idx).dropna()
        frames[str(bid)] = pd.DataFrame(
            {"nav": group["price_or_total_return_index"].to_numpy(), "obs_date": idx}, index=idx
        )
        currency[str(bid)] = str(group["currency"].iloc[0])
    return returns, frames, currency


def load_style_factors(con: Any) -> pd.DataFrame:
    """Wide date x benchmark_id monthly-return table for the style-factor basis.

    Style analysis regresses a fund on the whole basis at once, unlike every other
    benchmark use in this file which maps one scheme to one benchmark.
    """
    rows = con.execute(
        "SELECT benchmark_id, date, monthly_return FROM benchmarks WHERE asset_class = ? "
        "ORDER BY benchmark_id, date",
        [STYLE_FACTOR_CLASS],
    ).fetch_df()
    if rows.empty:
        return pd.DataFrame()
    return (
        rows.assign(date=pd.to_datetime(rows["date"]))
        .pivot(index="date", columns="benchmark_id", values="monthly_return")
        .dropna(how="all")
    )


def _v(metric: Metric) -> float | None:
    return metric.value


def compute_scheme_row(
    code: str,
    scheme: SchemeSeries,
    master_row: Mapping[str, Any],
    context: CategoryContext | None,
    benchmark_id: str | None,
    benchmark_returns: pd.Series | None,
    benchmark_frame: pd.DataFrame | None,
    benchmark_currency: str | None,
    drawdowns: Mapping[int, risk.Drawdown],
    drawdown_recovery: Mapping[str, pd.Timestamp | None],
    zero_nav_excluded: bool,
    settings: Settings,
    universe: PeerUniverse,
    as_of: pd.Timestamp,
    style_factors: pd.DataFrame | None = None,
) -> tuple[dict[str, Any], dict[int, pd.Series]]:
    rf = settings.risk_free_monthly
    tol = settings.mf_month_end_tolerance_days
    currency_mismatch = benchmark_currency is not None and benchmark_currency != BASE_CURRENCY
    if currency_mismatch:
        # A foreign-currency index and an INR NAV are not the same unit; refusing to
        # regress one on the other is the point, not an omission.
        benchmark_returns = None
        benchmark_frame = None
    # Why every benchmark-relative metric below is null, said once. Without this a
    # withheld FX comparison reads as "no data loaded", which invites someone to
    # "fix" it by loading the very series that must not be used.
    no_benchmark = (
        Reason.BENCHMARK_UNMAPPED
        if benchmark_id is None
        else Reason.BENCHMARK_CURRENCY
        if currency_mismatch
        else Reason.BENCHMARK_UNAVAILABLE
    )
    row: dict[str, Any] = {"scheme_code": code, "as_of_date": as_of.date()}
    reasons: dict[str, str] = {}
    flags: list[str] = []

    def put(name: str, metric: Metric) -> None:
        row[name] = metric.value
        if metric.value is None and metric.reason:
            # The window is short because the series was cut at a redenomination, not
            # because the fund is young. Say which, or the dash reads as a young fund.
            short_after_break = (
                scheme.scale_break_at is not None and metric.reason == Reason.INSUFFICIENT_HISTORY
            )
            reasons[name] = Reason.NAV_DISCONTINUITY if short_after_break else metric.reason

    own_cagr: dict[int, Metric] = {}
    for h in TRAILING_HORIZONS:
        res = trailing_cagr(scheme.monthly, h, tol)
        own_cagr[h] = res.metric
        put(f"cagr_{h}y", res.metric)
        row[f"cagr_{h}y_start"] = res.start_date.date() if res.start_date is not None else None
        put(f"sip_xirr_{h}y", cashflow.sip_xirr(scheme.monthly, h))

    # Only 3y and 5y: the same horizons every other rolling summary in this pipeline
    # reports a median for, and matching MF_MIN_ROLLING_WINDOWS keeps one floor for all of them.
    for h in (3, 5):
        put(
            f"rolling_sip_xirr_{h}y_median",
            cashflow.rolling_sip_xirr_median(scheme.monthly, h, settings.mf_min_rolling_windows),
        )

    rolling_series: dict[int, pd.Series] = {}
    for h in ROLLING_HORIZONS:
        series_h = rolling_cagr(scheme.monthly, h)
        rolling_series[h] = series_h
        summary = summarise_rolling(series_h, settings.mf_min_rolling_windows)
        put(f"rolling_{h}y_mean", summary.mean)
        put(f"rolling_{h}y_median", summary.median)
        put(f"rolling_{h}y_min", summary.minimum)
        put(f"rolling_{h}y_max", summary.maximum)
        put(f"rolling_{h}y_std", summary.std)
        put(f"rolling_{h}y_positive_pct", summary.positive_pct)
        row[f"rolling_{h}y_window_count"] = summary.window_count
        if context is not None:
            put(
                f"rolling_{h}y_beat_category_pct",
                beat_pct(series_h, context.rolling[h], settings.mf_min_rolling_windows),
            )
        else:
            row[f"rolling_{h}y_beat_category_pct"] = None
            reasons[f"rolling_{h}y_beat_category_pct"] = Reason.INSUFFICIENT_PEERS
        if benchmark_frame is not None:
            put(
                f"rolling_{h}y_beat_benchmark_pct",
                beat_pct(
                    series_h, rolling_cagr(benchmark_frame, h), settings.mf_min_rolling_windows
                ),
            )
        else:
            row[f"rolling_{h}y_beat_benchmark_pct"] = None
            reasons[f"rolling_{h}y_beat_benchmark_pct"] = no_benchmark

    for h in HORIZONS:
        if context is None:
            miss = Metric.missing(Reason.INSUFFICIENT_PEERS)
            for name in (
                f"category_return_{h}y",
                f"fund_minus_category_{h}y",
                f"fund_div_category_{h}y",
            ):
                put(name, miss)
            row[f"category_peer_count_{h}y"] = 0
            continue
        peer = relative.peer_average(
            context.cagr_by_scheme[h],
            code,
            aggregation=universe.aggregation,
            exclude_self=universe.exclude_self,
            min_peers=settings.mf_min_peers,
        )
        comparison = relative.compare_to_peers(own_cagr[h], peer)
        put(f"category_return_{h}y", comparison.category_return)
        put(f"fund_minus_category_{h}y", comparison.excess)
        put(f"fund_div_category_{h}y", comparison.ratio)
        row[f"category_peer_count_{h}y"] = comparison.peer_count

    for h in HORIZONS:
        if benchmark_frame is None:
            miss = Metric.missing(no_benchmark)
            put(f"benchmark_return_{h}y", miss)
            put(f"fund_minus_benchmark_{h}y", miss)
            continue
        bench = trailing_cagr(benchmark_frame, h, tol).metric
        put(f"benchmark_return_{h}y", bench)
        own = own_cagr[h]
        if bench.value is None or own.value is None:
            put(
                f"fund_minus_benchmark_{h}y",
                Metric.missing(bench.reason or own.reason or Reason.INSUFFICIENT_HISTORY),
            )
        else:
            put(f"fund_minus_benchmark_{h}y", Metric(own.value - bench.value, bench.n_obs))

    for h in HORIZONS:
        fund_r = _window(scheme.returns, as_of, h)
        min_obs = MIN_RISK_OBS[h]
        put(f"sharpe_{h}y", risk.sharpe(fund_r, rf, min_obs))
        put(f"sortino_{h}y", risk.sortino(fund_r, rf, min_obs))
        put(f"volatility_{h}y", risk.volatility(fund_r, min_obs))
        put(f"downside_deviation_{h}y", risk.downside_deviation(fund_r, rf, min_obs))

        if context is not None:
            cat_r = _window(
                context.ex_self_returns(code) if universe.exclude_self else context.equal_weighted,
                as_of,
                h,
            )
            put(
                f"information_ratio_vs_category_{h}y",
                risk.information_ratio(fund_r, cat_r, min_obs),
            )
            if h in CAPTURE_HORIZONS:
                # Same leave-one-out peer series as the information ratio just above,
                # not a benchmark: how much of the peer average's own rise and fall
                # this fund took part in.
                capture = risk.capture_ratios(fund_r, cat_r, min_obs)
                put(f"upside_capture_{h}y", capture.up)
                put(f"downside_capture_{h}y", capture.down)
        else:
            put(f"information_ratio_vs_category_{h}y", Metric.missing(Reason.INSUFFICIENT_PEERS))
            if h in CAPTURE_HORIZONS:
                miss = Metric.missing(Reason.INSUFFICIENT_PEERS)
                put(f"upside_capture_{h}y", miss)
                put(f"downside_capture_{h}y", miss)

        if benchmark_returns is not None:
            bench_r = _window(benchmark_returns, as_of, h)
            put(
                f"information_ratio_vs_benchmark_{h}y",
                risk.information_ratio(fund_r, bench_r, min_obs),
            )
            put(f"tracking_error_{h}y", risk.tracking_error(fund_r, bench_r, min_obs))
            reg = risk.alpha_beta(fund_r, bench_r, rf, min_obs)
            put(f"alpha_{h}y", reg.alpha)
            put(f"beta_{h}y", reg.beta)
            put(f"r_squared_{h}y", reg.r_squared)
            put(f"alpha_tstat_{h}y", reg.alpha_tstat)
            put(f"alpha_pvalue_{h}y", reg.alpha_pvalue)
            row[f"regression_obs_{h}y"] = reg.beta.n_obs
        else:
            miss = Metric.missing(no_benchmark)
            for name in (
                f"information_ratio_vs_benchmark_{h}y",
                f"tracking_error_{h}y",
                f"alpha_{h}y",
                f"beta_{h}y",
                f"r_squared_{h}y",
                f"alpha_tstat_{h}y",
                f"alpha_pvalue_{h}y",
            ):
                put(name, miss)
            row[f"regression_obs_{h}y"] = 0

        # Eligibility still comes from the month-end grid, so which funds report a
        # drawdown is unchanged; only the precision of the number improves.
        months_in_window = len(
            scheme.monthly["nav"][
                (scheme.monthly.index > as_of - pd.DateOffset(years=h))
                & (scheme.monthly.index <= as_of)
            ].dropna()
        )
        dd = (
            drawdowns.get(h, risk.Drawdown(Metric.missing(Reason.INSUFFICIENT_OBSERVATIONS)))
            if months_in_window >= min_obs
            else risk.Drawdown(Metric.missing(Reason.INSUFFICIENT_OBSERVATIONS, months_in_window))
        )
        put(f"max_drawdown_{h}y", dd.metric)
        if h == 5:
            row["max_drawdown_5y_peak"] = dd.peak_date.date() if dd.peak_date is not None else None
            row["max_drawdown_5y_trough"] = (
                dd.trough_date.date() if dd.trough_date is not None else None
            )
            if dd.metric.value is None:
                row["max_drawdown_5y_recovery_days"] = None
                if dd.metric.reason:
                    reasons["max_drawdown_5y_recovery_days"] = dd.metric.reason
            else:
                recovered = drawdown_recovery.get(code)
                if recovered is not None and dd.trough_date is not None:
                    row["max_drawdown_5y_recovery_days"] = int((recovered - dd.trough_date).days)
                else:
                    row["max_drawdown_5y_recovery_days"] = None
                    reasons["max_drawdown_5y_recovery_days"] = NOT_RECOVERED
        put(f"calmar_{h}y", risk.calmar(own_cagr[h], dd.metric))

    if style_factors is None or style_factors.empty:
        put("style_drift_3y", Metric.missing(Reason.BENCHMARK_UNAVAILABLE))
    else:
        windows = rolling_style_exposure(scheme.returns, style_factors)
        drift_floor = as_of - pd.DateOffset(years=3)
        recent = [w for w in windows if w.last_date is not None and w.last_date > drift_floor]
        put("style_drift_3y", style_drift(recent))

    # 12-1 momentum: the eleven months ending one month before the snapshot date. The
    # skipped month is the convention - the most recent month carries a short-term
    # reversal that says nothing about the manager - and it is what the backtest
    # measured (docs/backtest.md), where the unskipped one-year return was noisier.
    # MonthEnd(1) rather than DateOffset(months=1): a calendar month back from a 30th
    # lands on a 30th, which silently drops the 31st-dated month-end and leaves ten.
    momentum_window = scheme.returns[
        (scheme.returns.index > as_of - pd.DateOffset(years=1))
        & (scheme.returns.index <= as_of - pd.offsets.MonthEnd(1))
    ].dropna()
    if len(momentum_window) >= MOMENTUM_MIN_MONTHS:
        growth = float(cast(Any, (1.0 + momentum_window).prod()))
        put("momentum_12_1", Metric(growth - 1.0, len(momentum_window)))
    else:
        put(
            "momentum_12_1",
            Metric.missing(Reason.INSUFFICIENT_HISTORY, len(momentum_window)),
        )

    cal = _calendar_year_flags(scheme.returns, MIN_CALENDAR_YEARS)
    put("worst_calendar_year_return", cal["worst_calendar_year_return"])
    put("positive_calendar_years_pct", cal["positive_calendar_years_pct"])
    row["worst_calendar_year"] = cal["worst_calendar_year"]
    if cal["worst_calendar_year_return"].value is None:
        reasons["worst_calendar_year"] = cal["worst_calendar_year_return"].reason or (
            Reason.INSUFFICIENT_HISTORY
        )

    n_months = int(scheme.monthly["nav"].notna().sum())
    gaps = int(scheme.monthly["nav"].isna().sum())
    if gaps:
        flags.append("nav_gaps")
    if scheme.scale_break_at is not None:
        flags.append("nav_scale_discontinuity")
    # One flag per horizon the history cannot support, so a screen can exclude exactly
    # the funds too young for the column it sorts on rather than a single blanket cut.
    flags += [f"insufficient_history_{h}y" for h in TRAILING_HORIZONS if n_months < 12 * h]
    if zero_nav_excluded:
        flags.append("terminal_zero_nav_excluded")
    # AMFI issues a fresh scheme code when a fund is merged into another or renamed, so
    # a code with a couple of years of NAV sitting among peers that have decades of it is
    # more often a reissued code than a genuinely new fund. A hint to check, not a finding.
    if (
        context is not None
        and n_months < 36
        and scheme.monthly.index[0] > context.median_start + pd.DateOffset(years=5)
    ):
        flags.append("possible_merger_or_rebrand")
    if str(master_row.get("clean_sub_category") or "Unclassified") == "Unclassified":
        flags.append("no_category")
    if benchmark_id is None:
        flags.append("no_benchmark_mapping")
    if currency_mismatch:
        flags.append("benchmark_currency_mismatch")
    if str(master_row.get("clean_plan")) == "Unknown":
        flags.append("plan_ambiguous")
    if str(master_row.get("clean_option")) == "Unknown":
        flags.append("option_ambiguous")
    if not bool(master_row.get("is_active")):
        flags.append("inactive_or_matured")
    if bool(master_row.get("is_stale")):
        flags.append("stale_source_record")

    row.update(
        {
            "category_methodology": universe.model_dump_json(),
            "benchmark_id": benchmark_id,
            "peer_universe": universe.model_dump_json(),
            "category_key": context.key if context else None,
            "monthly_obs_count": n_months,
            "nav_gap_months": gaps,
            "data_quality_flags": json.dumps(flags),
            "missing_reasons": json.dumps(reasons),
            "methodology_version": settings.mf_methodology_version,
            "computed_at": datetime.now(UTC).replace(tzinfo=None),
        }
    )
    return row, rolling_series


SNAPSHOT_COLUMNS: list[str] = []


def _snapshot_columns(con: Any) -> list[str]:
    global SNAPSHOT_COLUMNS
    if not SNAPSHOT_COLUMNS:
        SNAPSHOT_COLUMNS = [
            r[0]
            for r in con.execute(
                "SELECT column_name FROM information_schema.columns "
                "WHERE table_name = 'scheme_metrics_snapshot' ORDER BY ordinal_position"
            ).fetchall()
        ]
    return SNAPSHOT_COLUMNS


class _RollingWriter:
    """Buffers per-scheme rolling series and inserts them a batch of schemes at a time.

    The full universe produces several million rows. Concatenating them into one frame
    before the insert would cost more memory than the rest of the build put together.
    """

    BATCH_SCHEMES = 2000

    def __init__(self, con: Any, methodology_version: str) -> None:
        self.con = con
        self.version = methodology_version
        self.buffer: list[pd.DataFrame] = []
        self.pending = 0
        self.written = 0
        con.execute("DELETE FROM rolling_returns_monthly")

    def add(self, code: str, series_by_horizon: Mapping[int, pd.Series]) -> None:
        for h, values in series_by_horizon.items():
            valid = values.dropna()
            if valid.empty:
                continue
            self.buffer.append(
                pd.DataFrame(
                    {
                        "scheme_code": code,
                        "horizon_years": h,
                        "date": pd.DatetimeIndex(valid.index).date,
                        "rolling_cagr": valid.to_numpy(),
                        "methodology_version": self.version,
                    }
                )
            )
        self.pending += 1
        if self.pending >= self.BATCH_SCHEMES:
            self._flush()

    def _flush(self) -> None:
        self.pending = 0
        if not self.buffer:
            return
        batch = pd.concat(self.buffer, ignore_index=True)
        self.buffer.clear()
        self.con.register("rolling_batch", batch)
        self.con.execute(
            "INSERT INTO rolling_returns_monthly "
            "SELECT scheme_code, horizon_years, date, rolling_cagr, methodology_version "
            "FROM rolling_batch"
        )
        self.con.unregister("rolling_batch")
        self.written += len(batch)

    def close(self) -> int:
        self._flush()
        return self.written


# Everything compute_scheme_row needs that is the same for every scheme. Set once in the
# parent and inherited by forked workers, so a worker is handed a scheme code and nothing
# else - the alternative, pickling the category contexts and benchmark frames per task,
# costs more than the computation it parallelises.
_SHARED: dict[str, Any] = {}


def _init_worker(shared: dict[str, Any]) -> None:
    _SHARED.update(shared)


def _compute_one(code: str) -> tuple[str, dict[str, Any], dict[int, pd.Series]]:
    """One scheme's snapshot row, from the shared state this process inherited."""
    sh = _SHARED
    bid = sh["mapping"].get(code)
    row, rolling = compute_scheme_row(
        code,
        sh["series"][code],
        sh["master_by_code"].get(code, {}),
        sh["by_scheme_context"].get(code),
        bid,
        sh["benchmark_returns"].get(bid) if bid else None,
        sh["benchmark_frames"].get(bid) if bid else None,
        sh["benchmark_currency"].get(bid) if bid else None,
        {h: d[code] for h, d in sh["drawdowns"].items() if code in d},
        sh["drawdown_recovery"],
        code in sh["zero_nav_schemes"],
        sh["settings"],
        sh["universe"],
        sh["as_of"],
        sh["style_factors"],
    )
    return code, row, rolling


def _scheme_rows(
    codes: list[str], shared: dict[str, Any], jobs: int
) -> Iterator[tuple[str, dict[str, Any], dict[int, pd.Series]]]:
    """Every scheme's row, computed serially or across `jobs` forked workers.

    Fork rather than spawn: the shared state is gigabytes of NAV series that the
    children only read, so copy-on-write hands it over for free where pickling it to
    each worker would not. The store's connection stays in the parent - a worker never
    touches DuckDB - and all writing stays on the parent's single write lock.
    """
    if jobs <= 1:
        _init_worker(shared)
        yield from (_compute_one(code) for code in codes)
        return
    context = get_context("fork")
    with ProcessPoolExecutor(
        max_workers=jobs, mp_context=context, initializer=_init_worker, initargs=(shared,)
    ) as pool:
        # Chunked so the per-task overhead does not swamp a fast scheme; the whole
        # universe in one chunk per worker would instead leave cores idle at the end.
        yield from pool.map(_compute_one, codes, chunksize=64)


def run(
    settings: Settings | None = None,
    universe: PeerUniverse | None = None,
    run_id: str | None = None,
    jobs: int = 1,
) -> dict[str, Any]:
    s = settings or get_settings()
    u = universe or DEFAULT_UNIVERSE
    started = datetime.now(UTC).replace(tzinfo=None)
    rid = run_id or started.strftime("%Y%m%dT%H%M%S")

    with connect(s) as con:
        init_schema(con)
        ensure_behaviour_columns(con)
        ensure_persistence_columns(con)
        ensure_exposure_columns(con)
        ensure_alpha_significance_columns(con)
        ensure_aum_columns(con)
        ensure_momentum_columns(con)
        register_nav_view(con, s)
        master = con.execute("SELECT * FROM scheme_master").fetch_df()
        master["scheme_code"] = master["scheme_code"].astype(str)
        series = load_series(con, s.mf_nav_jump_ratio)
        benchmark_returns, benchmark_frames, benchmark_currency = load_benchmarks(con)
        style_factors = load_style_factors(con)
        mapping = {
            str(r[0]): str(r[1])
            for r in con.execute(
                "SELECT scheme_code, benchmark_id FROM scheme_benchmark_map"
            ).fetchall()
        }
        if not series:
            raise RuntimeError(
                "No NAV data loaded. Run `make data-sample` or `make data-nav` first."
            )

        as_of = pd.Timestamp(max(sc.monthly.index[-1] for sc in series.values()))
        # T2.2: a peer group must mean the same thing across the window it is compared
        # over, so it is resolved as of the window's end date rather than as of today.
        master, category_resolution = resolve_categories_as_of(con, master, as_of)
        # T2.3: size-discipline inputs, cross-sectional over the whole master rather
        # than per-scheme, the same way quartile ranking is computed once below.
        aum_family_latest_by_code = dict(
            zip(master["scheme_code"], compute_aum_family_latest(master), strict=True)
        )
        aum_percentile_by_code = dict(
            zip(
                master["scheme_code"],
                compute_aum_percentile_in_sub_category(master, s.mf_min_peers),
                strict=True,
            )
        )
        aum_growth_by_code = compute_aum_growth(con)
        contexts = build_category_contexts(master, series, u, as_of, s)
        # T2.4: survivorship bias is a claim about a gap, and a gap needs both sides
        # measured the same way. The counterpart universe differs only in active_only,
        # so its contexts land under their own category_key (the active=y/n marker)
        # rather than overwriting the primary ones.
        survivorship_contexts = build_category_contexts(
            master, series, u.survivorship_counterpart(), as_of, s
        )
        drawdowns = daily_drawdowns(con, series, as_of)
        drawdown_recovery = daily_drawdown_recovery(con, series, as_of)
        by_scheme_context = {code: ctx for ctx in contexts.values() for code in ctx.members}

        zero_nav_schemes = {
            str(r[0]) for r in con.execute("SELECT scheme_code FROM nav_zero_excluded").fetchall()
        }
        rows: list[dict[str, Any]] = []
        master_by_code: dict[str, dict[str, Any]] = {
            str(r["scheme_code"]): cast(dict[str, Any], r) for r in master.to_dict("records")
        }
        rolling_writer = _RollingWriter(con, s.mf_methodology_version)
        codes = list(series.keys())
        total = len(codes)
        shared = {
            "series": series,
            "master_by_code": master_by_code,
            "by_scheme_context": by_scheme_context,
            "mapping": mapping,
            "benchmark_returns": benchmark_returns,
            "benchmark_frames": benchmark_frames,
            "benchmark_currency": benchmark_currency,
            "drawdowns": drawdowns,
            "drawdown_recovery": drawdown_recovery,
            "zero_nav_schemes": zero_nav_schemes,
            "settings": s,
            "universe": u,
            "as_of": as_of,
            "style_factors": style_factors,
        }
        for i, (code, row, rolling) in enumerate(_scheme_rows(codes, shared, jobs), start=1):
            row["category_resolution"] = category_resolution.get(code, "current")
            rows.append(row)
            rolling_writer.add(code, rolling)
            if i % 250 == 0 or i == total:
                print(f"  metrics {i}/{total} schemes", end="\r", flush=True)
        print()
        rolling_rows = rolling_writer.close()

        # Cross-sectional ranking needs every peer's rolling series in one place, so it
        # runs once here over the now-fully-written table rather than inside the
        # per-scheme loop above, which only ever sees one scheme at a time.
        membership = pd.DataFrame(
            [
                {"scheme_code": code, "category_key": ctx.key}
                for ctx in contexts.values()
                for code in ctx.members
            ]
        )
        quartile_metrics = persistence.build_quartile_metrics(
            persistence.rank_quartiles(con, membership, s.mf_methodology_version), s.mf_min_peers
        )
        for row in rows:
            per_scheme = quartile_metrics.get(row["scheme_code"], {})
            reasons = json.loads(row["missing_reasons"])
            for name in persistence.QUARTILE_METRIC_NAMES:
                metric = per_scheme.get(name, Metric.missing(Reason.INSUFFICIENT_PEERS))
                row[name] = metric.value
                if metric.value is None and metric.reason:
                    reasons[name] = metric.reason
            row["missing_reasons"] = json.dumps(reasons)

        # T2.3: attach the AUM-history-derived columns computed above per scheme.
        for row in rows:
            code = row["scheme_code"]
            reasons = json.loads(row["missing_reasons"])
            family_latest = aum_family_latest_by_code.get(code)
            row["aum_family_latest"] = float(family_latest) if pd.notna(family_latest) else None
            percentile = aum_percentile_by_code.get(code)
            if pd.notna(percentile):
                row["aum_percentile_in_sub_category"] = float(percentile)
            else:
                row["aum_percentile_in_sub_category"] = None
                reasons["aum_percentile_in_sub_category"] = Reason.INSUFFICIENT_PEERS
            growth = aum_growth_by_code.get(code)
            if growth is None:
                row["aum_growth_4q"] = None
                reasons["aum_growth_4q"] = INSUFFICIENT_AUM_HISTORY
            else:
                row["aum_growth_4q"] = growth
            row["missing_reasons"] = json.dumps(reasons)

        snapshot = pd.DataFrame(rows)
        columns = _snapshot_columns(con)
        for col in columns:
            if col not in snapshot.columns:
                snapshot[col] = None
        snapshot = snapshot.loc[:, columns]
        con.register("snap", snapshot)
        con.execute("DELETE FROM scheme_metrics_snapshot WHERE as_of_date = ?", [as_of.date()])
        con.execute(f"INSERT INTO scheme_metrics_snapshot SELECT {', '.join(columns)} FROM snap")
        con.unregister("snap")
        snapshot.to_parquet(s.processed_dir / "scheme_metrics_snapshot.parquet", index=False)

        ter = {
            str(code): float(value)
            for code, value in con.execute(
                "SELECT scheme_code, expense_ratio FROM scheme_ter"
            ).fetchall()
        }
        scores = compute_scores(snapshot, master, ter, s.mf_min_peers)
        scores["as_of_date"] = as_of.date()
        con.register("scores", scores)
        con.execute("DELETE FROM scheme_score_snapshot WHERE as_of_date = ?", [as_of.date()])
        con.execute(
            "INSERT INTO scheme_score_snapshot "
            "SELECT scheme_code, as_of_date, score, score_coverage, score_status FROM scores"
        )
        con.unregister("scores")

        # One write call, one category_key namespace: the active=y/n marker already
        # keeps the two universes' rows apart, so merging avoids a second full
        # DELETE FROM category_monthly_returns clobbering the first write.
        _write_category_tables(con, {**contexts, **survivorship_contexts}, as_of, s)
        record_ingest(
            con,
            rid,
            "metrics-build",
            started,
            "ok",
            row_count=len(snapshot),
            details={
                "as_of": str(as_of.date()),
                "categories": len(contexts),
                "survivorship_categories": len(survivorship_contexts),
                "rolling_return_rows": rolling_rows,
                "universe": u.model_dump(),
                "methodology_version": s.mf_methodology_version,
            },
        )
    info = {
        "schemes": len(snapshot),
        "categories": len(contexts),
        "rolling_return_rows": rolling_rows,
        "as_of": str(as_of.date()),
    }
    log_event(logger, "metrics.built", **info)
    return info


def _write_category_tables(
    con: Any, contexts: Mapping[str, CategoryContext], as_of: pd.Timestamp, settings: Settings
) -> None:
    monthly_rows: list[pd.DataFrame] = []
    snapshot_rows: list[dict[str, Any]] = []
    for ctx in contexts.values():
        frame = pd.DataFrame(
            {
                "category_key": ctx.key,
                "date": pd.DatetimeIndex(ctx.equal_weighted.index).date,
                "category_return_equal_weighted": ctx.equal_weighted.to_numpy(),
                "category_return_median": ctx.median_weighted.reindex(
                    ctx.equal_weighted.index
                ).to_numpy(),
                # AMFI publishes quarterly average AUM only, so there is no monthly
                # weight series to build an AUM-weighted category return from.
                "category_return_aum_weighted": np.nan,
                "eligible_scheme_count": ctx.eligible_counts.reindex(ctx.equal_weighted.index)
                .fillna(0)
                .astype(int)
                .to_numpy(),
                "methodology_version": settings.mf_methodology_version,
            }
        )
        monthly_rows.append(frame)
        summaries = {
            h: summarise_rolling(ctx.rolling[h], settings.mf_min_rolling_windows)
            for h in ROLLING_HORIZONS
        }
        vol = risk.volatility(_window(ctx.equal_weighted, as_of, 5), MIN_RISK_OBS[5])
        snapshot_rows.append(
            {
                "category_key": ctx.key,
                "as_of_date": as_of.date(),
                "level": ctx.key.split("=")[0],
                "label": ctx.label,
                **{f"cagr_{h}y": _v(ctx.trailing[h]) for h in TRAILING_HORIZONS},
                **{f"rolling_{h}y_median": _v(summaries[h].median) for h in ROLLING_HORIZONS},
                "volatility_5y": _v(vol),
                "eligible_scheme_count": len(ctx.members),
                "methodology_version": settings.mf_methodology_version,
            }
        )
    if not monthly_rows:
        return
    monthly = pd.concat(monthly_rows, ignore_index=True)
    con.register("cat_monthly", monthly)
    con.execute("DELETE FROM category_monthly_returns")
    con.execute(
        "INSERT INTO category_monthly_returns SELECT category_key, date, "
        "category_return_equal_weighted, category_return_median, "
        "category_return_aum_weighted, eligible_scheme_count, methodology_version "
        "FROM cat_monthly"
    )
    con.unregister("cat_monthly")

    snap = pd.DataFrame(snapshot_rows)
    con.register("cat_snap", snap)
    con.execute("DELETE FROM category_metrics_snapshot WHERE as_of_date = ?", [as_of.date()])
    cols = [
        r[0]
        for r in con.execute(
            "SELECT column_name FROM information_schema.columns "
            "WHERE table_name = 'category_metrics_snapshot' ORDER BY ordinal_position"
        ).fetchall()
    ]
    for col in cols:
        if col not in snap.columns:
            snap[col] = None
    con.register("cat_snap", snap.loc[:, cols])
    con.execute(f"INSERT INTO category_metrics_snapshot SELECT {', '.join(cols)} FROM cat_snap")
    con.unregister("cat_snap")


# --- T2.2: category-as-of resolution -----------------------------------------------


def resolve_categories_as_of(
    con: Any, master: pd.DataFrame, as_of: pd.Timestamp
) -> tuple[pd.DataFrame, dict[str, str]]:
    """Override clean_category/clean_sub_category with what scheme_category_history says
    was true as of the window's end date, so a mid-window SEBI reclassification does not
    silently change what an already-computed peer average meant.

    Falls back to the current scheme_master value - and reports "current" rather than
    "history" - for any scheme with no covering history row, which is the common case:
    history only accrues from the ingest that first observed a change.
    """
    as_of_date = as_of.date()
    hist = con.execute(
        "SELECT scheme_code, clean_category, clean_sub_category "
        "FROM scheme_category_history "
        "WHERE valid_from <= ? AND (valid_to IS NULL OR ? < valid_to)",
        [as_of_date, as_of_date],
    ).fetch_df()
    resolved = master.copy()
    codes = resolved["scheme_code"].astype(str)
    resolution = dict.fromkeys(codes, "current")
    if hist.empty:
        return resolved, resolution
    hist = hist.assign(scheme_code=hist["scheme_code"].astype(str)).set_index("scheme_code")
    matched = codes.isin(hist.index)
    resolved.loc[matched, "clean_category"] = codes[matched].map(hist["clean_category"]).to_numpy()
    resolved.loc[matched, "clean_sub_category"] = (
        codes[matched].map(hist["clean_sub_category"]).to_numpy()
    )
    # peer_group is derived from the two columns just overridden, so it has to follow
    # them back in time as well - otherwise a reclassified fund would be grouped by the
    # peer group it carries today against the sub-category it carried then.
    resolved.loc[matched, "peer_group"] = [
        classify.peer_group(c, sub, name, band)
        for c, sub, name, band in zip(
            resolved.loc[matched, "clean_category"],
            resolved.loc[matched, "clean_sub_category"],
            resolved.loc[matched, "scheme_name"],
            resolved.loc[matched, "cap_band"],
            strict=True,
        )
    ]
    for code in codes[matched]:
        resolution[code] = "history"
    return resolved, resolution


# --- Composite score, stored so the screener can sort and filter on it -------------
#
# The score is a percentile against a peer group, so it cannot be computed one fund at
# a time from that fund's own row - it needs the whole group. `GET /score/{code}` builds
# that group per request, which is fine for one fund and hopeless for a sortable column
# over 36k of them, so the same `score_fund` runs once here over every peer group.
#
# It lands in its own table rather than in scheme_metrics_snapshot because the cost
# component reads the expense ratio, and T3.1 keeps enrichment out of that table. The
# screen view left-joins this the same way it left-joins scheme_ter.


def compute_scores(
    snapshot: pd.DataFrame, master: pd.DataFrame, expense_ratio: dict[str, float], min_peers: int
) -> pd.DataFrame:
    """One score per scheme, ranked against the active Direct-Growth peers of its group.

    The peer rule is the one `GET /score/{code}` applies - a scheme that is not itself
    Direct-Growth is still scored, against the Direct-Growth peers a buyer chooses
    between - so the stored column and the endpoint can never disagree.
    """
    keys = ["scheme_code", "peer_group", "clean_plan", "clean_option", "is_active"]
    frame = snapshot.merge(master.loc[:, keys], on="scheme_code", how="left")
    frame["expense_ratio"] = frame["scheme_code"].map(expense_ratio)
    is_peer = (
        (frame["clean_plan"] == "Direct")
        & (frame["clean_option"] == "Growth")
        & frame["is_active"].astype("boolean").fillna(False)
    )

    rows: list[dict[str, object]] = []
    for group, members in frame.groupby("peer_group", sort=False):
        peers = members[is_peer.loc[members.index]].reset_index(drop=True)
        peer_codes = set(peers["scheme_code"])
        for code in members["scheme_code"]:
            pool = (
                peers
                if code in peer_codes
                else pd.concat([peers, members[members["scheme_code"] == code]], ignore_index=True)
            )
            result = score_fund(pool, str(code), min_peers=min_peers)
            rows.append(
                {
                    "scheme_code": code,
                    "score": result.total,
                    "score_coverage": result.coverage,
                    "score_status": result.status,
                }
            )
        del group
    return pd.DataFrame(rows, columns=["scheme_code", "score", "score_coverage", "score_status"])


# --- T2.1: fund family grouping report, for `make validate` -----------------------


def fund_family_grouping_summary(con: Any) -> dict[str, int]:
    """How many scheme codes collapsed into families, and how many resisted it.

    A family of one - a code that shares its fund_family_id with nothing - is by
    construction the ungrouped case: no ISIN or exact stripped-name match was found
    for it, so it was left alone rather than merged on a guess.
    """
    sizes = con.execute(
        "SELECT count(*) AS n FROM scheme_master GROUP BY fund_family_id"
    ).fetch_df()["n"]
    return {
        "scheme_codes": int(sizes.sum()),
        "fund_families": len(sizes),
        "codes_collapsed_into_families": int((sizes[sizes > 1]).sum()),
        "codes_resisted_grouping": int((sizes == 1).sum()),
    }
