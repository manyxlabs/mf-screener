"""Composite score: a transparent, weighted percentile ranking within a sub-category.

Every component is a percentile against the fund's own `clean_sub_category` peers,
never against the whole universe, so a debt fund is never ranked against an equity
one. Percentiles are computed with `pandas.Series.rank(pct=True)`, which depends only
on the set of peer values, never on the order rows arrive in.

This is a description of the past against declared, visible weights - never a rating
or a recommendation, and the two words are kept out of this module on purpose.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, field
from typing import Final, Literal

import pandas as pd

from .quality import Reason

Strategy = Literal["fallback", "average"]


@dataclass(frozen=True, slots=True)
class ComponentMetric:
    column: str
    higher_is_better: bool


@dataclass(frozen=True, slots=True)
class Component:
    metrics: tuple[ComponentMetric, ...]
    # "fallback": use the first metric with a value for this fund (Sharpe, or Sortino
    # when Sharpe alone is null). "average": average whichever of the metrics are
    # present, since both measure the same idea from a different angle.
    strategy: Strategy


# The declared weight table. Shown to the user on every /score response rather than
# buried in code, per T1.8's "no hidden weighting" requirement. Must sum to 1.0 -
# tests/test_scoring.py enforces this so the table can never silently drift off it.
COMPONENT_WEIGHTS: Final[dict[str, float]] = {
    "risk_adjusted_return": 0.30,
    "consistency": 0.20,
    "drawdown_behaviour": 0.20,
    "cost": 0.15,
    "size_discipline": 0.15,
}

# Every weighted component has a metric definition here. A fund needs the columns
# named below already present on `scheme_metrics_snapshot`.
COMPONENTS: Final[dict[str, Component]] = {
    "risk_adjusted_return": Component(
        (ComponentMetric("sharpe_5y", True), ComponentMetric("sortino_5y", True)), "fallback"
    ),
    "consistency": Component(
        (
            ComponentMetric("rolling_5y_median", True),
            ComponentMetric("quartile_persistence_3y", True),
        ),
        "average",
    ),
    "drawdown_behaviour": Component(
        (ComponentMetric("downside_capture_5y", False), ComponentMetric("max_drawdown_5y", True)),
        "average",
    ),
    "cost": Component((ComponentMetric("expense_ratio", False),), "average"),
    # T2.3's aum_percentile_in_sub_category is itself already a percentile of AUM
    # (1.0 = largest fund in the sub-category), so higher_is_better=False rewards
    # the smaller footprint: asset bloat is the risk this component exists to flag.
    "size_discipline": Component(
        (ComponentMetric("aum_percentile_in_sub_category", False),), "average"
    ),
}

SIZE_DISCIPLINE = "size_discipline"
# Not one of quality.Reason: this covers only a store that predates T2.3 and has
# never computed aum_percentile_in_sub_category at all, which Reason.INSUFFICIENT_PEERS
# would misstate as merely a thin peer group for this fund's own sub-category.
SIZE_DISCIPLINE_REASON: Final[str] = "aum_history_not_available"

# Kept local rather than merged into quality.Reason, the same way pipeline.py keeps its
# own NOT_RECOVERED description - this reason belongs to scoring, not to a metric.
REASON_DESCRIPTIONS: Final[dict[str, str]] = {
    SIZE_DISCIPLINE_REASON: (
        "Size discipline needs aum_percentile_in_sub_category, which this store has "
        "not computed at all - a build made before T2.3 added AUM history, rather "
        "than this particular fund's peer group being too thin. It is named missing "
        "here rather than dropped from the weight table or filled in with the "
        "category mean, which would flatter a fund whose data is simply absent."
    ),
}


@dataclass(frozen=True, slots=True)
class ComponentScore:
    percentile: float | None  # 0..1 within the sub-category peer group, 1 is best
    contribution: float | None  # percentile * weight * 100, in score points
    reason: str | None  # why percentile/contribution are null, when they are


@dataclass(frozen=True, slots=True)
class ScoreResult:
    scheme_code: str
    total: float | None  # sum of the present components' contributions, out of 100
    status: Literal["complete", "partial"]
    components: dict[str, ComponentScore]
    weights: dict[str, float] = field(default_factory=dict)
    missing: tuple[str, ...] = ()


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


def _component_percentile(
    peers: pd.DataFrame, row_label: int, component: Component, min_peers: int
) -> float | None:
    values: list[float] = []
    for metric in component.metrics:
        pct = _percentile(peers, metric.column, metric.higher_is_better, min_peers).loc[row_label]
        if pd.notna(pct):
            values.append(float(pct))
            if component.strategy == "fallback":
                return values[0]
    return sum(values) / len(values) if values else None


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

    components: dict[str, ComponentScore] = {}
    missing: list[str] = []
    total = 0.0
    have_any = False
    for name, weight in weights.items():
        if name not in COMPONENTS:
            components[name] = ComponentScore(None, None, "component_not_defined")
            missing.append(name)
            continue
        component = COMPONENTS[name]
        if name == SIZE_DISCIPLINE and not any(
            m.column in peers.columns for m in component.metrics
        ):
            components[name] = ComponentScore(None, None, SIZE_DISCIPLINE_REASON)
            missing.append(name)
            continue
        pct = _component_percentile(peers, row_label, component, min_peers)
        if pct is None:
            components[name] = ComponentScore(None, None, Reason.INSUFFICIENT_PEERS)
            missing.append(name)
            continue
        contribution = pct * weight * 100.0
        components[name] = ComponentScore(pct, contribution, None)
        total += contribution
        have_any = True

    return ScoreResult(
        scheme_code=scheme_code,
        total=total if have_any else None,
        status="complete" if not missing else "partial",
        components=components,
        weights=dict(weights),
        missing=tuple(missing),
    )
