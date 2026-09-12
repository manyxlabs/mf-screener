from __future__ import annotations

import pandas as pd
import pytest

from mf_analytics import scoring
from mf_analytics.quality import Reason


def _peers() -> pd.DataFrame:
    # Five funds sharing a sub-category, so min_peers=5 (the default) is exactly met.
    return pd.DataFrame(
        {
            "scheme_code": ["A", "B", "C", "D", "E"],
            "sharpe_5y": [1.5, 0.8, 0.5, 1.2, 0.3],
            "sortino_5y": [1.9, 1.0, 0.6, 1.6, 0.4],
            "rolling_5y_median": [0.16, 0.12, 0.10, 0.14, 0.09],
            "quartile_persistence_3y": [0.9, 0.5, 0.4, 0.8, 0.3],
            "downside_capture_5y": [0.80, 0.95, 1.05, 0.85, 1.10],
            "max_drawdown_5y": [-0.18, -0.30, -0.35, -0.20, -0.40],
            "expense_ratio": [0.008, 0.015, 0.020, 0.010, 0.022],
        }
    )


def test_weights_sum_to_one() -> None:
    assert sum(scoring.COMPONENT_WEIGHTS.values()) == pytest.approx(1.0)


def test_fund_a_scores_best_on_every_present_component() -> None:
    result = scoring.score_fund(_peers(), "A")
    # A has the best (or tied-best) value on every underlying metric, so every
    # component percentile should be 1.0 and the total the full available weight.
    for name in ("risk_adjusted_return", "consistency", "drawdown_behaviour", "cost"):
        assert result.components[name].percentile == pytest.approx(1.0)
    assert result.status == "partial"  # size_discipline is always missing
    assert result.missing == ("size_discipline",)
    # size_discipline carries no percentile/contribution, and total omits it.
    expected_total = sum(
        scoring.COMPONENT_WEIGHTS[c] * 100.0
        for c in ("risk_adjusted_return", "consistency", "drawdown_behaviour", "cost")
    )
    assert result.total == pytest.approx(expected_total)


def test_size_discipline_is_named_missing_not_imputed() -> None:
    result = scoring.score_fund(_peers(), "C")
    comp = result.components["size_discipline"]
    assert comp.percentile is None
    assert comp.contribution is None
    assert comp.reason == scoring.SIZE_DISCIPLINE_REASON


def test_row_order_does_not_change_the_score() -> None:
    peers = _peers()
    forward = scoring.score_fund(peers, "C")
    shuffled = peers.sample(frac=1.0, random_state=7).reset_index(drop=True)
    backward = scoring.score_fund(shuffled, "C")
    assert forward.total == pytest.approx(backward.total)
    for name in scoring.COMPONENT_WEIGHTS:
        assert forward.components[name].percentile == backward.components[name].percentile


def test_removing_a_component_from_weights_leaves_other_contributions_unchanged() -> None:
    peers = _peers()
    full = scoring.score_fund(peers, "B")
    trimmed_weights = {k: v for k, v in scoring.COMPONENT_WEIGHTS.items() if k != "cost"}
    trimmed = scoring.score_fund(peers, "B", weights=trimmed_weights)
    assert "cost" not in trimmed.components
    for name in ("risk_adjusted_return", "consistency", "drawdown_behaviour"):
        assert trimmed.components[name].contribution == pytest.approx(
            full.components[name].contribution
        )
        assert trimmed.components[name].percentile == pytest.approx(
            full.components[name].percentile
        )


def test_null_sharpe_and_sortino_flags_partial_and_omits_the_component() -> None:
    peers = _peers()
    peers.loc[peers["scheme_code"] == "C", ["sharpe_5y", "sortino_5y"]] = None
    result = scoring.score_fund(peers, "C")
    comp = result.components["risk_adjusted_return"]
    assert comp.percentile is None
    assert comp.contribution is None
    assert comp.reason == Reason.INSUFFICIENT_PEERS
    assert "risk_adjusted_return" in result.missing
    assert result.status == "partial"
    # Total must be the sum of only the components that are actually present -
    # never a total that silently substitutes a category-mean guess.
    other_total = sum(
        c.contribution for name, c in result.components.items() if c.contribution is not None
    )
    assert result.total == pytest.approx(other_total)


def test_sortino_fills_in_when_only_sharpe_is_null() -> None:
    peers = _peers()
    peers.loc[peers["scheme_code"] == "C", "sharpe_5y"] = None
    result = scoring.score_fund(peers, "C")
    comp = result.components["risk_adjusted_return"]
    assert comp.percentile is not None
    assert comp.reason is None


def test_below_min_peers_withholds_the_component() -> None:
    small = _peers().iloc[:3].reset_index(drop=True)  # only 3 peers, default floor is 5
    result = scoring.score_fund(small, "A", min_peers=5)
    for name in ("risk_adjusted_return", "consistency", "drawdown_behaviour", "cost"):
        comp = result.components[name]
        assert comp.percentile is None
        assert comp.reason == Reason.INSUFFICIENT_PEERS
    assert result.total is None
    assert result.status == "partial"


def test_unknown_scheme_code_raises() -> None:
    with pytest.raises(KeyError):
        scoring.score_fund(_peers(), "ZZZ")
