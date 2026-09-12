"""Peer-relative comparison: leave-one-out category returns, excess and ratio."""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass

import numpy as np
import pandas as pd

from ..quality import Metric, Reason

MIN_PEERS_AFTER_EXCLUSION = 2


@dataclass(frozen=True, slots=True)
class PeerComparison:
    category_return: Metric
    excess: Metric
    ratio: Metric
    peer_count: int


def peer_average(
    values: Mapping[str, float],
    scheme_code: str,
    *,
    aggregation: str = "mean",
    exclude_self: bool = True,
    min_peers: int = 5,
) -> Metric:
    """Peer-universe CAGR, by default excluding the scheme being measured.

    `min_peers` is checked on the universe including the scheme, matching how the
    eligibility rule is presented in the UI; after exclusion at least two must remain.
    """
    clean = {k: float(v) for k, v in values.items() if v is not None and np.isfinite(v)}
    if len(clean) < min_peers:
        return Metric.missing(Reason.INSUFFICIENT_PEERS, len(clean))
    peers = dict(clean)
    if exclude_self:
        peers.pop(scheme_code, None)
        if len(peers) < MIN_PEERS_AFTER_EXCLUSION:
            return Metric.missing(Reason.INSUFFICIENT_PEERS, len(peers))
    series = pd.Series(list(peers.values()), dtype=float)
    value = float(series.median()) if aggregation == "median" else float(series.mean())
    return Metric(value, len(peers))


def compare_to_peers(own: Metric, peer: Metric) -> PeerComparison:
    """Excess in percentage points always; ratio only when the denominator is positive."""
    if own.value is None:
        miss = Metric.missing(own.reason or Reason.INSUFFICIENT_HISTORY, own.n_obs)
        return PeerComparison(peer, miss, miss, peer.n_obs)
    if peer.value is None:
        miss = Metric.missing(peer.reason or Reason.INSUFFICIENT_PEERS, peer.n_obs)
        return PeerComparison(peer, miss, miss, peer.n_obs)
    excess = Metric(own.value - peer.value, peer.n_obs)
    if peer.value <= 0:
        ratio = Metric.missing(Reason.SIGN_CHANGING_DENOMINATOR, peer.n_obs)
    else:
        ratio = Metric(own.value / peer.value, peer.n_obs)
    return PeerComparison(peer, excess, ratio, peer.n_obs)


def category_monthly_return(
    returns_by_scheme: Mapping[str, pd.Series],
    *,
    aggregation: str = "mean",
    exclude: str | None = None,
) -> pd.Series:
    """Equal-weighted (or median) cross-sectional monthly return of the peer universe."""
    members = {k: v for k, v in returns_by_scheme.items() if k != exclude}
    if not members:
        return pd.Series(dtype="float64")
    frame = pd.DataFrame(members)
    agg = frame.median(axis=1) if aggregation == "median" else frame.mean(axis=1)
    return agg.dropna().rename("category_return")


def eligible_counts(returns_by_scheme: Mapping[str, pd.Series]) -> pd.Series:
    if not returns_by_scheme:
        return pd.Series(dtype="int64")
    return pd.DataFrame(returns_by_scheme).notna().sum(axis=1).rename("eligible_scheme_count")
