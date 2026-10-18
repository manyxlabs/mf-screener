"""Composite score: a transparent, weighted percentile ranking within a peer group.

Every component is a percentile against the fund's own `peer_group` peers, never
against the whole universe, so a debt fund is never ranked against an equity one.
The group is the sub-category refined by what the fund actually holds - SEBI files
by legal wrapper, which would otherwise rank a Nasdaq feeder against gold funds -
and `classify.peer_group` defines it.

Percentiles are computed with `pandas.Series.rank(pct=True)`, which depends only on
the set of peer values, never on the order rows arrive in.

Each component blends the 3-, 5- and 10-year reading of one idea, so a long record
counts for more without shutting out a fund that does not have one yet: a component
renormalises over the horizons it has, and the total renormalises over the components
it has. A fund is therefore scored on the same scale whether or not it is old enough
to own a ten-year column, and `coverage` says how much of the weight table it could
actually answer.

Metrics that rank the same funds the same way are deliberately not counted twice. Two
were measured on the live universe (579 active Direct-Growth equity funds, Spearman
within sub-category): cagr_5y against fund_minus_category_5y ranks 1.000 identically,
and sharpe_5y against sortino_5y 0.990. Raw CAGR therefore carries no separate weight -
inside one peer group it *is* the peer-excess ranking - and Sortino serves only as
Sharpe's stand-in. Cost and size carry no weight here; they are columns to read beside
the score, not part of it.

This is a description of the past against declared, visible weights - never a rating
or a recommendation, and the two words are kept out of this module on purpose.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, field
from typing import Final, Literal

import pandas as pd

from .quality import Reason

HORIZONS: Final[tuple[str, ...]] = ("3y", "5y", "10y")

# What one horizon is worth inside every component. Measured rather than assumed: the
# same four formation dates, pooled fund-weighted IC against the forward 3-year return
# (docs/backtest.md), read one horizon against the other -
#
#   rolling median   3y +0.127 (4 of 4 dates)   5y +0.118 (4 of 4)
#   CAGR             3y +0.088 (3 of 4)         5y +0.083 (3 of 4)
#   Sharpe           3y +0.057 (2 of 4)         5y +0.044 (3 of 4)
#
# - which is a dead heat, well inside the noise of four overlapping windows. The three
# year reading wins the small margin it has on coverage rather than accuracy: it exists
# for 2,234 fund-observations against 1,841, and for 30 sub-categories against 25.
#
# So three years is raised toward five rather than past it. The reason it does not lead
# outright is what carried it at the 2022 formation date, where cagr_3y scored +0.340
# beside cagr_1y +0.339 and momentum_12_1 +0.291: at short horizons the return column
# *is* the momentum signal, which this table deliberately prices at 0.10 because it is
# unstable. A 3-year-led score would buy that same bet back at several times the weight.
#
# Ten years is unmeasured - too few funds owned a decade of history at a past formation
# date to correlate - and holds the remainder on the same reasoning it always did.
HORIZON_WEIGHTS: Final[dict[str, float]] = {"3y": 0.35, "5y": 0.40, "10y": 0.25}

# A score built on the 3-year window alone would rank a fund on one market phase, so a
# total is withheld below this share of the weight table rather than published thin.
MIN_COVERAGE: Final[float] = 0.5


@dataclass(frozen=True, slots=True)
class ComponentMetric:
    column: str
    higher_is_better: bool


@dataclass(frozen=True, slots=True)
class Component:
    """One idea, read at each horizon through the first metric that has a value.

    `metrics` is a fallback chain per horizon, not a blend: every entry measures the
    same thing, so the second is only consulted where the first is null. A metric whose
    column carries no `{h}` has one reading rather than three - a fee and a one-year
    momentum are single numbers, not a family of windows - and is scored once.
    """

    metrics: tuple[ComponentMetric, ...]
    description: str

    @property
    def horizon_free(self) -> bool:
        return all("{h}" not in m.column for m in self.metrics)

    def columns(self, horizon: str) -> tuple[ComponentMetric, ...]:
        return tuple(
            ComponentMetric(m.column.format(h=horizon), m.higher_is_better) for m in self.metrics
        )


# The declared weight table, shown to the user on every /score response rather than
# buried in code. Must sum to 1.0 - tests/test_scoring.py enforces this so the table
# can never silently drift off it.
#
# These are what `scripts/backtest_score.py` measured, not what reads well. Forming the
# ranking at four past dates from NAV alone and correlating each signal with the next
# three years, within sub-category (docs/backtest.md):
#
#   12-1 momentum                  IC +0.17, right sign at 3 of 4 dates
#   expense ratio (lower better)   IC +0.14, right sign at 4 of 4
#   rolling median (consistency)   IC +0.13, right sign at 4 of 4
#   peer excess / CAGR             IC +0.09, right sign at 3 of 4
#   Sharpe / Sortino               IC +0.05, right sign at 2 of 4
#   low volatility (steadiness)    IC -0.21, WRONG sign at 4 of 4
#
# Cost is weighted above its IC rank because it is the one signal with outside
# corroboration: Morningstar's repeated study finds the cheapest quintile beats the
# priciest in every period tested, while past-performance measures do not. It is also
# the only input here that is mechanical - a fee is deducted whatever the market does.
#
# Steadiness keeps a weight in spite of its sign, and the reason is not that the
# measurement is doubted: over a window where Indian equity rose almost throughout, the
# calmer fund was reliably the one that returned less. It is here as a stated preference
# for a smoother ride, not as a claim about future return, and the owner set it to 0.02
# rather than 0 - lowered because it is the only component measured pointing the wrong
# way, kept because a score with no risk term at all would rank a fund that fell 60% and
# recovered above one that never fell, and say nothing about the difference.
#
# Its freed 0.03 went to consistency rather than to cost. Both were right at 4 of 4
# dates, but the rolling median is measured point-in-time while the expense ratio is
# read from today's snapshot against a past formation date, so only one of the two is
# uncontaminated evidence.
#
# Momentum took 0.05 from risk-adjusted return on `scripts/optimize_weights.py`: 28
# quarterly formation dates, tables chosen on early dates and judged on later held-out
# ones, at 1y and 3y forward. That move raised IC in all four (train and test, both
# horizons) and lifted the worst held-out 3y date from +0.11 to +0.17. A further 0.05
# kept helping at 3y but cut the 1y held-out hit rate from 70% to 66%, so it stops here;
# the grid search's own winners, 70-80% on a single component, all lost to this table on
# the held-out dates.
COMPONENT_WEIGHTS: Final[dict[str, float]] = {
    "consistency": 0.33,
    "cost": 0.20,
    "peer_excess": 0.20,
    "risk_adjusted_return": 0.10,
    "momentum": 0.10,
    "steadiness": 0.02,
    # Untested by the backtest: it needs a benchmark series mapped as of the formation
    # date, which the stored map does not carry. Priced at the low end until it is.
    "index_skill": 0.05,
}

COMPONENTS: Final[dict[str, Component]] = {
    "peer_excess": Component(
        (
            ComponentMetric("fund_minus_category_{h}", True),
            ComponentMetric("information_ratio_vs_category_{h}", True),
        ),
        "Return above the sub-category average. Identical in rank to raw CAGR here, so "
        "it carries the return weight for both.",
    ),
    "cost": Component(
        (ComponentMetric("expense_ratio", False),),
        "The annual fee, which is deducted whatever the market does. Blank where the TER "
        "disclosure does not cover the scheme - which is a gap in the source, not a zero fee.",
    ),
    "momentum": Component(
        (ComponentMetric("momentum_12_1", True),),
        "The eleven months ending one month ago. The skipped month is the convention: the "
        "most recent month carries a reversal that says nothing about the manager.",
    ),
    "consistency": Component(
        (ComponentMetric("rolling_{h}_median", True),),
        "The typical window, not the one that happened to end today: the median of every "
        "rolling window of this length.",
    ),
    "risk_adjusted_return": Component(
        (ComponentMetric("sharpe_{h}", True), ComponentMetric("sortino_{h}", True)),
        "Return per unit of risk. Sortino stands in only where Sharpe is null.",
    ),
    "steadiness": Component(
        (ComponentMetric("volatility_{h}", False),),
        "Annualised standard deviation of returns, lower ranking higher.",
    ),
    "index_skill": Component(
        (
            ComponentMetric("information_ratio_vs_benchmark_{h}", True),
            ComponentMetric("alpha_{h}", True),
        ),
        "Excess return over the fund's own benchmark per unit of tracking error, with "
        "alpha as the stand-in. Blank wherever no benchmark series is mapped.",
    ),
}

# Kept local rather than merged into quality.Reason, the same way pipeline.py keeps its
# own NOT_RECOVERED description - these reasons belong to scoring, not to a metric.
THIN_COVERAGE_REASON: Final[str] = "coverage_below_floor"
# A component can go missing for two quite different reasons, and "too few peers" is the
# wrong story for a metric the store has never computed - it sends someone looking at the
# peer group when the fix is a metrics rebuild.
NOT_COMPUTED_REASON: Final[str] = "metric_not_computed"
REASON_DESCRIPTIONS: Final[dict[str, str]] = {
    NOT_COMPUTED_REASON: (
        "This component's metric is not in the stored snapshot at all - it was added to "
        "the weight table after the last metrics rebuild. Run `make metrics` to compute "
        "it; until then the component is named missing and its weight is redistributed."
    ),
    THIN_COVERAGE_REASON: (
        "Fewer than half the weighted components could be computed for this fund, so no "
        "total is published. The components that exist are still shown with their own "
        "percentiles: read those instead of a total built on a fraction of the table."
    ),
}


@dataclass(frozen=True, slots=True)
class ComponentScore:
    percentile: float | None  # 0..1 within the sub-category peer group, 1 is best
    contribution: float | None  # share of this component's weight, in score points
    reason: str | None  # why percentile/contribution are null, when they are
    horizons: tuple[str, ...] = ()  # the horizons that actually fed the percentile


@dataclass(frozen=True, slots=True)
class ScoreResult:
    scheme_code: str
    total: float | None  # 0..100, renormalised over the components present
    status: Literal["complete", "partial"]
    components: dict[str, ComponentScore]
    weights: dict[str, float] = field(default_factory=dict)
    missing: tuple[str, ...] = ()
    coverage: float = 0.0  # share of the weight table this fund could answer
    reason: str | None = None  # why `total` is null, when it is


def _percentile(
    peers: pd.DataFrame, column: str, higher_is_better: bool, min_peers: int
) -> pd.Series:
    """Percentile rank of every peer's value in `column`, best value -> 1.0.

    A peer missing the value cannot occupy a rank, so it is excluded from the ranking
    population before computing percentiles, not scored at the bottom. Below
    `min_peers` eligible values the whole column is withheld for this peer group.
    """
    values = peers[column] if column in peers.columns else pd.Series(index=peers.index, dtype=float)
    eligible = values.notna()
    if int(eligible.sum()) < min_peers:
        return pd.Series(float("nan"), index=peers.index)
    ranked = values[eligible].rank(pct=True, ascending=higher_is_better)
    return ranked.reindex(peers.index)


def _horizon_percentile(
    peers: pd.DataFrame, row_label: int, component: Component, horizon: str, min_peers: int
) -> float | None:
    for metric in component.columns(horizon):
        pct = _percentile(peers, metric.column, metric.higher_is_better, min_peers).loc[row_label]
        if pd.notna(pct):
            return float(pct)
    return None


def _component_percentile(
    peers: pd.DataFrame, row_label: int, component: Component, min_peers: int
) -> tuple[float | None, tuple[str, ...]]:
    """Blend the horizons this fund has, renormalised over their weights.

    A fund with only a 3-year record is scored on its 3-year record rather than
    docked for the windows it has not lived through; what it could not answer shows
    up in `coverage`, not as a silent zero.
    """
    if component.horizon_free:
        for metric in component.metrics:
            pct = _percentile(peers, metric.column, metric.higher_is_better, min_peers).loc[
                row_label
            ]
            if pd.notna(pct):
                return float(pct), ()
        return None, ()
    weighted = 0.0
    weight_present = 0.0
    used: list[str] = []
    for horizon in HORIZONS:
        pct = _horizon_percentile(peers, row_label, component, horizon, min_peers)
        if pct is None:
            continue
        weight = HORIZON_WEIGHTS[horizon]
        weighted += weight * pct
        weight_present += weight
        used.append(horizon)
    if not weight_present:
        return None, ()
    return weighted / weight_present, tuple(used)


def score_fund(
    peers: pd.DataFrame,
    scheme_code: str,
    min_peers: int = 5,
    weights: Mapping[str, float] | None = None,
) -> ScoreResult:
    """Score one fund against the other rows of `peers` (its own sub-category only).

    `peers` must include `scheme_code`'s own row plus every eligible peer, with a
    `scheme_code` column identifying each. Row order never affects the result.
    """
    weights = dict(weights) if weights is not None else dict(COMPONENT_WEIGHTS)
    matches = peers.index[peers["scheme_code"] == scheme_code]
    if len(matches) == 0:
        raise KeyError(f"{scheme_code} is not in the supplied peer group")
    row_label = int(matches[0])

    percentiles: dict[str, tuple[float, tuple[str, ...]]] = {}
    components: dict[str, ComponentScore] = {}
    missing: list[str] = []
    for name in weights:
        if name not in COMPONENTS:
            components[name] = ComponentScore(None, None, "component_not_defined")
            missing.append(name)
            continue
        component = COMPONENTS[name]
        pct, used = _component_percentile(peers, row_label, component, min_peers)
        if pct is None:
            columns = {
                metric.column
                for horizon in (HORIZONS if not component.horizon_free else ("3y",))
                for metric in component.columns(horizon)
            }
            uncomputed = columns.isdisjoint(peers.columns)
            reason = NOT_COMPUTED_REASON if uncomputed else Reason.INSUFFICIENT_PEERS
            components[name] = ComponentScore(None, None, reason)
            missing.append(name)
            continue
        percentiles[name] = (pct, used)

    # Renormalising over the weight that is present is what makes a young fund and an
    # old one comparable: without it every score would just re-rank funds by how much
    # history they happen to have.
    coverage = sum(weights[name] for name in percentiles)
    total_weight = sum(weights.values())
    coverage_share = coverage / total_weight if total_weight else 0.0
    publishable = coverage_share >= MIN_COVERAGE

    for name, (pct, used) in percentiles.items():
        contribution = (weights[name] / coverage) * pct * 100.0 if publishable else None
        components[name] = ComponentScore(pct, contribution, None, used)

    total = (
        sum(c.contribution or 0.0 for c in components.values() if c.contribution is not None)
        if publishable
        else None
    )
    return ScoreResult(
        scheme_code=scheme_code,
        total=total,
        status="complete" if not missing else "partial",
        components=components,
        weights=dict(weights),
        missing=tuple(missing),
        coverage=coverage_share,
        reason=None if publishable else THIN_COVERAGE_REASON,
    )
