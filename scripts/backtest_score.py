"""Backtest the composite score: does a high score at time T precede better returns after T?

The test forms a ranking using only NAV up to a formation date, then measures what each
fund actually returned afterwards. Nothing from the stored snapshot is used - every input
is recomputed from the monthly series as of the formation date, through the same metric
functions the pipeline uses - so the ranking cannot see its own future.

Reported per formation date: forward CAGR by score quintile, the top decile against the
universe, and the rank correlation between score and forward return. A score that works
should show a monotone quintile ladder and a positive correlation; one that does not is
worth knowing about before anyone screens on it.

Known biases, none of them corrected here:
  - Survivorship: only schemes present in today's master are in the file at all, so funds
    wound up between T and now are largely absent, which flatters every bucket equally.
  - The peer group is today's label, not the one the fund carried at T.
  - Formation dates overlap, so the four runs are not four independent experiments.

Usage: uv run python scripts/backtest_score.py [--formation 2019-08-31 ...] [--horizon 3]
"""

from __future__ import annotations

import argparse
from dataclasses import dataclass

import duckdb
import pandas as pd

from mf_analytics.config import get_settings
from mf_analytics.metrics.risk import sharpe, sortino, volatility
from mf_analytics.metrics.series import monthly_returns, rolling_cagr, trailing_cagr
from mf_analytics.scoring import HORIZONS, score_fund

# The score's peer group. A fund is ranked against the funds a buyer would have been
# choosing between, which is why plan and option are pinned rather than pooled.
UNIVERSE_SQL = """
SELECT m.scheme_code, m.scheme_name, m.peer_group, m.clean_plan, m.clean_option,
       t.expense_ratio
FROM scheme_master m
LEFT JOIN scheme_ter t ON t.scheme_code = m.scheme_code
WHERE m.clean_plan = 'Direct' AND m.clean_option = 'Growth'
  AND m.peer_group IS NOT NULL
"""

NAV_SQL = """
SELECT scheme_code, date, nav, obs_date
FROM nav_monthly
WHERE date <= ?
ORDER BY scheme_code, date
"""

MIN_PEERS = 5
QUINTILES = 5


@dataclass(frozen=True, slots=True)
class Formed:
    features: pd.DataFrame  # one row per fund: the score inputs as of the formation date
    forward: pd.Series  # forward CAGR from the formation date, indexed by scheme_code


def _features_as_of(
    nav: pd.DataFrame,
    universe: pd.DataFrame,
    as_of: pd.Timestamp,
    rf_monthly: float,
    flow: pd.DataFrame | None = None,
) -> pd.DataFrame:
    """Recompute every score input from NAV up to `as_of`, one row per fund."""
    rows: list[dict[str, object]] = []
    for code, frame in nav.groupby("scheme_code", sort=False):
        monthly = frame.set_index("date")[["nav", "obs_date"]].sort_index()
        if len(monthly) < 36:  # nothing to say about a fund with under three years
            continue
        returns = monthly_returns(monthly)["monthly_return"].dropna()
        row: dict[str, object] = {"scheme_code": code}
        # cagr_1y is the stored column nearest to 12-1 momentum, and the score can only
        # use a column the pipeline already computes - so it is measured beside it.
        one_year = trailing_cagr(monthly, 1)
        row["cagr_1y"] = one_year.metric.value
        for horizon in HORIZONS:
            years = int(horizon.rstrip("y"))
            cagr = trailing_cagr(monthly, years)
            row[f"cagr_{horizon}"] = cagr.metric.value
            window = returns.tail(years * 12)
            if len(window) >= years * 12:
                row[f"sharpe_{horizon}"] = sharpe(window, rf_monthly).value
                row[f"sortino_{horizon}"] = sortino(window, rf_monthly).value
                row[f"volatility_{horizon}"] = volatility(window).value
            rolling = rolling_cagr(monthly, years)
            # The same floor the pipeline uses: a median over two windows is not a median.
            row[f"rolling_{horizon}_median"] = (
                float(rolling.median()) if len(rolling) >= 12 else None
            )
        # 12-1 momentum: the eleven months ending one month before the formation date.
        # The skipped month is the convention - the most recent month carries a reversal
        # that has nothing to do with the manager. Machine-learning work on fund selection
        # (Kaniel et al., NBER 2022) finds this and fund flow the two characteristics that
        # survive out of sample, so it is measured here rather than assumed.
        if len(returns) >= 12:
            row["momentum_12_1"] = float((1.0 + returns.iloc[-12:-1]).prod() - 1.0)
        rows.append(row)
    features = pd.DataFrame(rows)
    if features.empty:
        return features
    features = features.merge(universe, on="scheme_code", how="inner")
    if flow is not None:
        features = features.merge(flow, on="scheme_code", how="left")

    # Peer excess, leave-one-out so a fund never competes with its own contribution to
    # the average - the definition the live fund_minus_category_* columns use.
    for horizon in (*HORIZONS, "momentum"):
        column = f"cagr_{horizon}" if horizon != "momentum" else "momentum_12_1"
        grouped = features.groupby("peer_group")[column]
        count = grouped.transform("count")
        total = grouped.transform("sum")
        peer_mean = (total - features[column]) / (count - 1)
        name = f"fund_minus_category_{horizon}" if horizon != "momentum" else "momentum_vs_peers"
        features[name] = features[column] - peer_mean.where(count > MIN_PEERS)
    return features


FLOW_SQL = """
WITH quarters AS (
    SELECT scheme_code, aum_date, latest_aum,
           row_number() OVER (PARTITION BY scheme_code ORDER BY aum_date DESC) AS recency
    FROM scheme_aum_history
    WHERE aum_date <= ? AND latest_aum > 0
)
SELECT l.scheme_code,
       l.latest_aum / e.latest_aum - 1.0 AS flow_4q,
       -- Assets grow for two quite different reasons: money arriving, and the money
       -- already there going up. Dividing the asset ratio by the fund's own NAV ratio
       -- over the same span strips the second out, leaving what units were bought or
       -- sold. Without this, "flow" is largely last year's return wearing a hat - and
       -- last year's return is already a signal in its own right here.
       (l.latest_aum / e.latest_aum) / (nl.nav / ne.nav) - 1.0 AS flow_implied_4q
FROM quarters l
JOIN quarters e USING (scheme_code)
JOIN nav_monthly nl ON nl.scheme_code = l.scheme_code AND nl.date = l.aum_date AND nl.nav > 0
JOIN nav_monthly ne ON ne.scheme_code = e.scheme_code AND ne.date = e.aum_date AND ne.nav > 0
WHERE l.recency = 1 AND e.recency = 5
"""


def _flow_as_of(con: duckdb.DuckDBPyConnection, as_of: pd.Timestamp) -> pd.DataFrame:
    """Four-quarter growth in a scheme's assets, using only quarters published by `as_of`.

    Point-in-time in a way the expense-ratio test could not be: `scheme_aum_history` is
    a real series, so this is the fund flow the machine-learning literature names, not a
    proxy for it. It is asset growth rather than net subscriptions - market movement is
    in there too - which is what AMFI publishes.
    """
    frame = con.execute(FLOW_SQL, [as_of.date()]).df()
    frame["scheme_code"] = frame["scheme_code"].astype(str)
    return frame


def _forward_cagr(
    con: duckdb.DuckDBPyConnection, as_of: pd.Timestamp, horizon_years: int
) -> pd.Series:
    """Realised annualised return from `as_of` to `as_of + horizon_years`.

    Month-end NAV on both ends, so this is the return a buyer at the formation date
    would have seen, not a return measured to today for some funds and to T+3 for others.
    """
    end = as_of + pd.DateOffset(years=horizon_years)
    frame = con.execute(
        """
        WITH start AS (
            SELECT scheme_code, nav FROM nav_monthly WHERE date = ?
        ), finish AS (
            SELECT scheme_code, nav FROM nav_monthly WHERE date = ?
        )
        SELECT s.scheme_code, s.nav AS start_nav, f.nav AS end_nav
        FROM start s JOIN finish f USING (scheme_code)
        WHERE s.nav > 0 AND f.nav > 0
        """,
        [as_of.date(), (end + pd.offsets.MonthEnd(0)).date()],
    ).df()
    if frame.empty:
        return pd.Series(dtype="float64")
    cagr = (frame["end_nav"] / frame["start_nav"]) ** (1.0 / horizon_years) - 1.0
    return pd.Series(cagr.to_numpy(), index=frame["scheme_code"].astype(str))


def _score_universe(features: pd.DataFrame) -> pd.DataFrame:
    """Score every fund against its own peer group, exactly as /score does."""
    scored: list[dict[str, object]] = []
    for peer_group, peers in features.groupby("peer_group"):
        peers = peers.reset_index(drop=True)
        if len(peers) < MIN_PEERS + 1:
            continue
        for code in peers["scheme_code"]:
            result = score_fund(peers, str(code), min_peers=MIN_PEERS)
            if result.total is None:
                continue
            scored.append(
                {
                    "scheme_code": str(code),
                    "peer_group": peer_group,
                    "score": result.total,
                    "coverage": result.coverage,
                }
            )
    return pd.DataFrame(scored)


def _report(label: str, scored: pd.DataFrame, forward: pd.Series, horizon_years: int) -> None:
    merged = scored.join(forward.rename("forward"), on="scheme_code").dropna(subset=["forward"])
    if len(merged) < QUINTILES * 4:
        print(f"\n{label}: only {len(merged)} funds with a full forward window - skipped")
        return
    merged["quintile"] = pd.qcut(merged["score"].rank(method="first"), QUINTILES, labels=False) + 1
    print(f"\n{label}  ({len(merged)} funds, forward {horizon_years}y CAGR)")
    print(f"  {'quintile':>9} {'funds':>6} {'median':>8} {'mean':>8} {'worst':>8} {'best':>8}")
    for quintile, group in merged.groupby("quintile"):
        print(
            f"  {int(quintile):>9} {len(group):>6} "
            f"{group['forward'].median():>7.2%} {group['forward'].mean():>7.2%} "
            f"{group['forward'].min():>7.2%} {group['forward'].max():>7.2%}"
        )
    top, bottom = merged[merged["quintile"] == QUINTILES], merged[merged["quintile"] == 1]
    spread = top["forward"].median() - bottom["forward"].median()
    universe_median = merged["forward"].median()
    decile = merged.nlargest(max(len(merged) // 10, 1), "score")
    rank_corr = merged["score"].rank().corr(merged["forward"].rank())
    print(f"  top quintile - bottom quintile (median): {spread:+.2%}")
    print(f"  top decile median {decile['forward'].median():.2%} vs universe {universe_median:.2%}")
    print(f"  Spearman(score, forward return): {rank_corr:+.3f}")
    beat = (decile["forward"] > universe_median).mean()
    print(f"  share of the top decile that beat the universe median: {beat:.0%}")

    # Within peer group, which is the only comparison the score claims to make: a
    # universe-wide ladder can be driven entirely by which categories did well.
    per_category = []
    for peer_group, group in merged.groupby("peer_group"):
        if len(group) < 10:
            continue
        best = group.nlargest(max(len(group) // 5, 1), "score")["forward"].median()
        per_category.append(
            {
                "peer_group": peer_group,
                "funds": len(group),
                "top_quintile": best,
                "category_median": group["forward"].median(),
                "edge": best - group["forward"].median(),
            }
        )
    if per_category:
        table = pd.DataFrame(per_category).sort_values("funds", ascending=False)
        wins = (table["edge"] > 0).mean()
        print(
            f"  within peer group: top quintile beat the group median in "
            f"{wins:.0%} of {len(table)} peer groups, median edge "
            f"{table['edge'].median():+.2%}"
        )
        for row in table.head(8).itertuples():
            print(
                f"     {row.peer_group[:34]:34} n={row.funds:>4} "
                f"top {row.top_quintile:>7.2%} vs {row.category_median:>7.2%} "
                f"edge {row.edge:+.2%}"
            )


# Every signal the weight table could draw on, with the direction it is read in.
SIGNALS: dict[str, bool] = {
    **{f"cagr_{h}": True for h in HORIZONS},
    **{f"rolling_{h}_median": True for h in HORIZONS},
    **{f"sharpe_{h}": True for h in HORIZONS},
    **{f"sortino_{h}": True for h in HORIZONS},
    **{f"volatility_{h}": False for h in HORIZONS},
    # The one signal here that is not point-in-time: TER is stored as a single current
    # snapshot with no history, so this reads today's fee against a past formation date.
    # Fees move slowly, so it is worth measuring - but it is suggestive, not clean.
    "expense_ratio": False,
    "momentum_12_1": True,
    "momentum_vs_peers": True,
    "cagr_1y": True,
    "flow_4q": True,
    "flow_implied_4q": True,
}


def _information_coefficients(features: pd.DataFrame, forward: pd.Series) -> pd.DataFrame:
    """Within-peer-group rank correlation of each signal with the forward return.

    Pooled across peer groups weighted by fund count, because that is the only
    comparison the score makes: a signal that merely picks the right category would
    score well across the whole universe and be useless inside one.
    """
    frame = features.join(forward.rename("forward"), on="scheme_code").dropna(subset=["forward"])
    rows = []
    for signal, higher_is_better in SIGNALS.items():
        if signal not in frame.columns:
            continue
        weighted, funds, groups = 0.0, 0, 0
        for _, group in frame.groupby("peer_group"):
            pair = group[[signal, "forward"]].dropna()
            if len(pair) < 10:
                continue
            ic = pair[signal].rank().corr(pair["forward"].rank())
            if pd.isna(ic):
                continue
            ic = ic if higher_is_better else -ic
            weighted += len(pair) * ic
            funds += len(pair)
            groups += 1
        if funds:
            rows.append(
                {"signal": signal, "ic": weighted / funds, "funds": funds, "peer_groups": groups}
            )
    return pd.DataFrame(rows)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--formation",
        nargs="+",
        default=["2019-08-31", "2020-08-31", "2021-08-31", "2022-08-31"],
        help="month-end formation dates",
    )
    parser.add_argument("--horizon", type=int, default=3, help="forward window in years")
    parser.add_argument(
        "--mode",
        choices=("score", "ic", "both"),
        default="both",
        help="score: quintiles of the composite. ic: per-signal predictive power.",
    )
    args = parser.parse_args()

    settings = get_settings()
    rf_monthly = settings.risk_free_monthly
    con = duckdb.connect(str(settings.mf_duckdb_path), read_only=True)
    universe = con.execute(UNIVERSE_SQL).df()
    universe["scheme_code"] = universe["scheme_code"].astype(str)
    print(f"universe: {len(universe)} Direct-Growth schemes with a peer group")
    ic_frames: list[pd.DataFrame] = []

    for formation in args.formation:
        as_of = pd.Timestamp(formation)
        nav = con.execute(NAV_SQL, [as_of.date()]).df()
        nav["scheme_code"] = nav["scheme_code"].astype(str)
        nav["date"] = pd.to_datetime(nav["date"])
        features = _features_as_of(nav, universe, as_of, rf_monthly, _flow_as_of(con, as_of))
        if features.empty:
            print(f"\n{formation}: no fund had three years of NAV by then")
            continue
        forward = _forward_cagr(con, as_of, args.horizon)
        if args.mode in ("score", "both"):
            _report(f"formed {formation}", _score_universe(features), forward, args.horizon)
        if args.mode in ("ic", "both"):
            table = _information_coefficients(features, forward)
            if table.empty:
                continue
            print(f"\n  signal vs forward {args.horizon}y return, within peer group:")
            for row in table.sort_values("ic", ascending=False).itertuples():
                print(
                    f"     {row.signal:24} IC {row.ic:+.3f}  "
                    f"({row.funds} funds over {row.peer_groups} peer groups)"
                )
            ic_frames.append(table.assign(formation=formation))

    if ic_frames:
        _pooled(ic_frames)


def _pooled(ic_frames: list[pd.DataFrame]) -> None:
    pooled = pd.concat(ic_frames)
    print("\n=== pooled across formation dates (fund-weighted mean IC, and how often > 0) ===")
    summary = (
        pooled.assign(weighted=pooled["ic"] * pooled["funds"])
        .groupby("signal")
        .agg(
            ic=("weighted", "sum"),
            funds=("funds", "sum"),
            positive=("ic", lambda s: (s > 0).mean()),
            dates=("ic", "size"),
        )
    )
    summary["ic"] = summary["ic"] / summary["funds"]
    for row in summary.sort_values("ic", ascending=False).itertuples():
        print(
            f"  {row.Index:24} IC {row.ic:+.3f}  positive in {row.positive:.0%} of "
            f"{row.dates} formations  ({row.funds} fund-observations)"
        )


if __name__ == "__main__":
    main()
