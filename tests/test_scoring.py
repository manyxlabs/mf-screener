from __future__ import annotations

import pandas as pd
import pytest

from mf_analytics import scoring
from mf_analytics.quality import Reason


def _peers() -> pd.DataFrame:
    """Five funds sharing a sub-category, so min_peers=5 (the default) is exactly met.

    A is best on every metric at every horizon, E worst, and the 10-year columns are
    present for everyone - the tests that care about a missing horizon strip them.
    """
    ordered = {
        "fund_minus_category": [0.05, 0.02, 0.00, 0.03, -0.02],
        "information_ratio_vs_category": [0.9, 0.4, 0.1, 0.6, -0.3],
        "rolling_median": [0.16, 0.12, 0.10, 0.14, 0.09],
        "sharpe": [1.5, 0.8, 0.5, 1.2, 0.3],
        "sortino": [1.9, 1.0, 0.6, 1.6, 0.4],
        "information_ratio_vs_benchmark": [0.8, 0.3, 0.1, 0.5, -0.4],
        "alpha": [0.04, 0.01, 0.00, 0.02, -0.03],
    }
    frame = {"scheme_code": ["A", "B", "C", "D", "E"]}
    for horizon in scoring.HORIZONS:
        for stem, values in ordered.items():
            if stem == "rolling_median":
                frame[f"rolling_{horizon}_median"] = list(values)
            else:
                frame[f"{stem}_{horizon}"] = list(values)
        # Lower is better, so A has to be the calmest rather than the most volatile.
        frame[f"volatility_{horizon}"] = [0.10, 0.16, 0.20, 0.13, 0.24]
    # Horizon-free components: one reading each, A best as everywhere else.
    frame["expense_ratio"] = [0.004, 0.012, 0.018, 0.009, 0.021]  # lower is better
    frame["momentum_12_1"] = [0.30, 0.18, 0.10, 0.22, 0.05]
    return pd.DataFrame(frame)


def test_weights_sum_to_one() -> None:
    assert sum(scoring.COMPONENT_WEIGHTS.values()) == pytest.approx(1.0)
    assert sum(scoring.HORIZON_WEIGHTS.values()) == pytest.approx(1.0)
    assert set(scoring.HORIZON_WEIGHTS) == set(scoring.HORIZONS)
    assert set(scoring.COMPONENT_WEIGHTS) == set(scoring.COMPONENTS)


def test_the_best_fund_on_every_metric_scores_100_and_the_worst_scores_lowest() -> None:
    peers = _peers()
    best = scoring.score_fund(peers, "A")
    assert best.status == "complete"
    assert best.coverage == pytest.approx(1.0)
    assert best.total == pytest.approx(100.0)
    for name, component in best.components.items():
        assert component.percentile == pytest.approx(1.0)
        expected = () if scoring.COMPONENTS[name].horizon_free else scoring.HORIZONS
        assert component.horizons == expected
    worst = scoring.score_fund(peers, "E")
    assert worst.total == pytest.approx(20.0)  # last of five peers is the 0.2 percentile
    assert worst.total < scoring.score_fund(peers, "C").total < best.total


def test_contributions_sum_to_the_total() -> None:
    result = scoring.score_fund(_peers(), "D")
    assert result.total == pytest.approx(
        sum(c.contribution for c in result.components.values() if c.contribution is not None)
    )


def test_a_fund_with_no_ten_year_record_is_not_docked_for_it() -> None:
    """The whole point of renormalising: history length must not become the ranking."""
    peers = _peers()
    short = peers.copy()
    for column in [c for c in short.columns if "10y" in c]:
        short[column] = None
    full = scoring.score_fund(peers, "D")
    trimmed = scoring.score_fund(short, "D")
    assert trimmed.status == "complete"
    assert trimmed.coverage == pytest.approx(1.0)
    assert trimmed.total == pytest.approx(full.total)
    for name, component in trimmed.components.items():
        if not scoring.COMPONENTS[name].horizon_free:
            assert component.horizons == ("3y", "5y")


def test_a_total_is_withheld_once_coverage_falls_below_the_floor() -> None:
    peers = _peers()
    for stem in ("sharpe", "sortino", "volatility", "information_ratio_vs_benchmark", "alpha"):
        for horizon in scoring.HORIZONS:
            peers[f"{stem}_{horizon}"] = None
    peers["momentum_12_1"] = None
    # What is left - consistency, cost and peer excess - is over the floor, so the total
    # is still published, renormalised over it.
    remaining = sum(scoring.COMPONENT_WEIGHTS[c] for c in ("consistency", "cost", "peer_excess"))
    assert remaining >= scoring.MIN_COVERAGE
    above_floor = scoring.score_fund(peers, "A")
    assert above_floor.coverage == pytest.approx(remaining)
    assert above_floor.total == pytest.approx(100.0)

    for horizon in scoring.HORIZONS:
        peers[f"rolling_{horizon}_median"] = None
    peers["expense_ratio"] = None
    result = scoring.score_fund(peers, "A")
    assert result.total is None
    assert result.reason == scoring.THIN_COVERAGE_REASON
    assert result.coverage == pytest.approx(scoring.COMPONENT_WEIGHTS["peer_excess"])
    # The components that do exist keep their percentile: a thin score is still readable.
    assert result.components["peer_excess"].percentile == pytest.approx(1.0)
    assert result.components["peer_excess"].contribution is None


def test_row_order_does_not_change_the_score() -> None:
    peers = _peers()
    forward = scoring.score_fund(peers, "C")
    shuffled = peers.sample(frac=1.0, random_state=7).reset_index(drop=True)
    backward = scoring.score_fund(shuffled, "C")
    assert forward.total == pytest.approx(backward.total)
    for name in scoring.COMPONENT_WEIGHTS:
        assert forward.components[name].percentile == backward.components[name].percentile


def test_a_missing_component_is_named_and_its_weight_redistributed() -> None:
    peers = _peers()
    for horizon in scoring.HORIZONS:
        peers[f"volatility_{horizon}"] = None
    result = scoring.score_fund(peers, "A")
    steadiness = result.components["steadiness"]
    assert steadiness.percentile is None
    assert steadiness.contribution is None
    assert steadiness.reason == Reason.INSUFFICIENT_PEERS
    assert result.missing == ("steadiness",)
    assert result.status == "partial"
    assert result.coverage == pytest.approx(1.0 - scoring.COMPONENT_WEIGHTS["steadiness"])
    # Renormalised, not summed short: the best fund on what remains still reads 100.
    assert result.total == pytest.approx(100.0)


def test_a_metric_the_store_never_computed_says_so(caplog) -> None:
    """ "Too few peers" would send someone to the peer group; the fix is a rebuild."""
    peers = _peers().drop(columns=["momentum_12_1"])
    result = scoring.score_fund(peers, "A")
    assert result.components["momentum"].reason == scoring.NOT_COMPUTED_REASON
    # A column that exists but is too thin still reads as a peer-group problem.
    thin = _peers()
    thin.loc[thin.index[1:], "momentum_12_1"] = None
    assert scoring.score_fund(thin, "A").components["momentum"].reason == Reason.INSUFFICIENT_PEERS


def test_the_fallback_metric_only_fills_a_null() -> None:
    peers = _peers()
    for horizon in scoring.HORIZONS:
        peers[f"sharpe_{horizon}"] = None
    result = scoring.score_fund(peers, "C")
    component = result.components["risk_adjusted_return"]
    assert component.reason is None
    # Sortino ranks C third of five exactly as Sharpe did, so the stand-in is silent.
    assert component.percentile == pytest.approx(
        scoring.score_fund(_peers(), "C").components["risk_adjusted_return"].percentile
    )


def test_below_min_peers_withholds_every_component() -> None:
    small = _peers().iloc[:3].reset_index(drop=True)  # only 3 peers, default floor is 5
    result = scoring.score_fund(small, "A", min_peers=5)
    for component in result.components.values():
        assert component.percentile is None
        assert component.reason == Reason.INSUFFICIENT_PEERS
    assert result.total is None
    assert result.coverage == pytest.approx(0.0)
    assert result.status == "partial"


def test_unknown_scheme_code_raises() -> None:
    with pytest.raises(KeyError):
        scoring.score_fund(_peers(), "ZZZ")
