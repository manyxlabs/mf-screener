"""Quartile ranking and persistence: does a fund's peer-relative rank hold up over time.

Past performance chasing is the error this measures against. Ranking the whole
universe at every month end is a bulk operation, so it runs as one DuckDB
window-function query over `rolling_returns_monthly` - the same table
`pipeline._RollingWriter` already populates - rather than per-scheme ranking in pandas.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import pandas as pd

from ..quality import Metric, Reason

# quartile_now is reported at both; persistence, top-share and the transition count are
# defined only at 3y, per T1.4's spec - a 5y quartile inside a fixed 5y lookback window
# would be little more than "now" repeated.
QUARTILE_HORIZONS: tuple[int, ...] = (3, 5)
PERSISTENCE_HORIZON: int = 3
PERSISTENCE_WINDOW_YEARS: int = 5

QUARTILE_METRIC_NAMES: tuple[str, ...] = (
    "quartile_now_3y",
    "quartile_now_5y",
    "quartile_persistence_3y",
    "quartile_top_share_3y",
    "quartile_transitions_3y",
)

_RANK_SQL = """
SELECT r.scheme_code, r.horizon_years, r.date,
       count(*) OVER (PARTITION BY u.category_key, r.horizon_years, r.date) AS peer_count,
       ntile(4) OVER (
           PARTITION BY u.category_key, r.horizon_years, r.date
           ORDER BY r.rolling_cagr DESC
       ) AS quartile
FROM rolling_returns_monthly r
JOIN quartile_universe u USING (scheme_code)
WHERE r.horizon_years IN ({horizons}) AND r.methodology_version = $version
"""

_EMPTY_RANKED_COLUMNS = ["scheme_code", "horizon_years", "date", "peer_count", "quartile"]


def rank_quartiles(
    con: Any,
    membership: pd.DataFrame,
    methodology_version: str,
    horizons: tuple[int, ...] = QUARTILE_HORIZONS,
) -> pd.DataFrame:
    """Every scheme's month-end quartile inside its own peer category, per horizon.

    `membership` carries one row per (scheme_code, category_key) - the same peer
    universe `pipeline.build_category_contexts` already computed, so ranking can never
    use a different eligibility rule than the rest of the snapshot.
    """
    if membership.empty:
        return pd.DataFrame(columns=_EMPTY_RANKED_COLUMNS)
    con.register("quartile_universe", membership)
    try:
        sql = _RANK_SQL.format(horizons=", ".join(str(h) for h in horizons))
        return con.execute(sql, {"version": methodology_version}).fetch_df()
    finally:
        con.unregister("quartile_universe")


@dataclass(frozen=True, slots=True)
class QuartileSummary:
    now: Metric
    persistence: Metric
    top_share: Metric
    transitions: Metric


def _eligible(quartile: pd.Series, peer_count: pd.Series, min_peers: int) -> pd.Series:
    """Month-end quartiles from dates that met the minimum peer count, oldest first."""
    return quartile[peer_count >= min_peers].dropna().sort_index()


def summarise_now(quartile: pd.Series, peer_count: pd.Series, min_peers: int) -> Metric:
    """The latest eligible month end's quartile - `quartile_now_{h}y`."""
    eligible = _eligible(quartile, peer_count, min_peers)
    if eligible.empty:
        return Metric.missing(Reason.INSUFFICIENT_PEERS, len(eligible))
    return Metric(float(eligible.iloc[-1]), len(eligible))


def summarise_persistence(
    quartile: pd.Series, peer_count: pd.Series, min_peers: int
) -> QuartileSummary:
    """`quartile`/`peer_count` are one scheme's 3y series, indexed by month-end date.

    Persistence and the top-quartile share are read off the same trailing 5-year
    window the transition count uses, so the three numbers describe one window.
    """
    eligible = _eligible(quartile, peer_count, min_peers)
    if eligible.empty:
        miss = Metric.missing(Reason.INSUFFICIENT_PEERS, 0)
        return QuartileSummary(miss, miss, miss, miss)
    now = int(eligible.iloc[-1])
    as_of = eligible.index[-1]
    window = eligible[eligible.index > as_of - pd.DateOffset(years=PERSISTENCE_WINDOW_YEARS)]
    now_metric = Metric(float(now), len(eligible))
    persistence = Metric(float((window == now).mean()), len(window))
    top_share = Metric(float((window == 1).mean()), len(window))
    # Each adjacent pair of ranked month ends that lands in a different quartile is one
    # transition; the first observation in the window has no predecessor to compare.
    transitions = int((window.diff().dropna() != 0).sum())
    transitions_metric = Metric(float(transitions), len(window))
    return QuartileSummary(now_metric, persistence, top_share, transitions_metric)


def build_quartile_metrics(ranked: pd.DataFrame, min_peers: int) -> dict[str, dict[str, Metric]]:
    """One `{column_name: Metric}` dict per scheme, ready to merge into a snapshot row."""
    if ranked.empty:
        return {}
    ranked = ranked.copy()
    ranked["date"] = pd.to_datetime(ranked["date"])
    out: dict[str, dict[str, Metric]] = {}
    for (code, horizon), group in ranked.groupby(["scheme_code", "horizon_years"], sort=False):
        g = group.set_index("date").sort_index()
        result = out.setdefault(str(code), {})
        if horizon == PERSISTENCE_HORIZON:
            summary = summarise_persistence(g["quartile"], g["peer_count"], min_peers)
            result["quartile_now_3y"] = summary.now
            result["quartile_persistence_3y"] = summary.persistence
            result["quartile_top_share_3y"] = summary.top_share
            result["quartile_transitions_3y"] = summary.transitions
        else:
            result[f"quartile_now_{horizon}y"] = summarise_now(
                g["quartile"], g["peer_count"], min_peers
            )
    return out
