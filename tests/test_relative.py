"""Peer-universe averages, leave-one-out behaviour and ratio safety."""

from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from mf_analytics.metrics.relative import (
    category_monthly_return,
    compare_to_peers,
    eligible_counts,
    peer_average,
)
from mf_analytics.quality import Metric, Reason

VALUES = {"A": 0.10, "B": 0.12, "C": 0.14, "D": 0.16, "E": 0.18}


def test_peer_average_excludes_self_by_default():
    result = peer_average(VALUES, "A", min_peers=5)
    assert result.value == pytest.approx(np.mean([0.12, 0.14, 0.16, 0.18]))
    assert result.n_obs == 4


def test_peer_average_include_self():
    result = peer_average(VALUES, "A", exclude_self=False, min_peers=5)
    assert result.value == pytest.approx(np.mean(list(VALUES.values())))
    assert result.n_obs == 5


def test_peer_average_median_aggregation():
    result = peer_average(VALUES, "A", aggregation="median", min_peers=5)
    assert result.value == pytest.approx(np.median([0.12, 0.14, 0.16, 0.18]))


def test_peer_average_requires_minimum_universe():
    result = peer_average({"A": 0.1, "B": 0.2}, "A", min_peers=5)
    assert result.value is None
    assert result.reason == Reason.INSUFFICIENT_PEERS


def test_single_scheme_category_yields_no_peer_average():
    """A sub-category with one scheme can never produce a peer comparison."""
    result = peer_average({"A": 0.10}, "A", min_peers=1)
    assert result.value is None
    assert result.reason == Reason.INSUFFICIENT_PEERS


def test_peer_average_needs_two_peers_after_exclusion():
    result = peer_average({"A": 0.1, "B": 0.2}, "A", min_peers=2)
    assert result.value is None
    assert result.reason == Reason.INSUFFICIENT_PEERS


def test_excess_and_ratio_for_positive_peer_return():
    comparison = compare_to_peers(Metric(0.20, 60), Metric(0.16, 4))
    assert comparison.excess.value == pytest.approx(0.04)
    assert comparison.ratio.value == pytest.approx(0.20 / 0.16)


@pytest.mark.parametrize("peer_value", [0.0, -0.05])
def test_ratio_suppressed_for_zero_or_negative_peer_return(peer_value):
    """A ratio against a non-positive denominator is misleading, so it is withheld."""
    comparison = compare_to_peers(Metric(0.10, 60), Metric(peer_value, 4))
    assert comparison.ratio.value is None
    assert comparison.ratio.reason == Reason.SIGN_CHANGING_DENOMINATOR
    assert comparison.excess.value == pytest.approx(0.10 - peer_value)


def test_comparison_propagates_missing_fund_return():
    comparison = compare_to_peers(Metric.missing(Reason.INSUFFICIENT_HISTORY), Metric(0.16, 4))
    assert comparison.excess.value is None
    assert comparison.excess.reason == Reason.INSUFFICIENT_HISTORY


def test_category_monthly_return_equal_weighted_and_median():
    index = pd.date_range("2020-01-31", periods=3, freq="ME")
    members = {
        "A": pd.Series([0.01, 0.02, 0.03], index=index),
        "B": pd.Series([0.03, 0.02, 0.01], index=index),
        "C": pd.Series([0.05, np.nan, 0.02], index=index),
    }
    equal = category_monthly_return(members)
    assert equal.loc[index[0]] == pytest.approx(0.03)
    assert equal.loc[index[1]] == pytest.approx(0.02)
    median = category_monthly_return(members, aggregation="median")
    assert median.loc[index[0]] == pytest.approx(0.03)
    assert eligible_counts(members).loc[index[1]] == 2


def test_category_monthly_return_excludes_named_scheme():
    index = pd.date_range("2020-01-31", periods=2, freq="ME")
    members = {
        "A": pd.Series([0.10, 0.10], index=index),
        "B": pd.Series([0.02, 0.04], index=index),
        "C": pd.Series([0.04, 0.02], index=index),
    }
    assert category_monthly_return(members, exclude="A").tolist() == pytest.approx([0.03, 0.03])
