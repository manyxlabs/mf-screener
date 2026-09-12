"""Correlation across funds and blended-portfolio risk over their matched history.

Every figure here is derived from monthly NAV returns already computed elsewhere in
this package (`risk.py`); nothing is recomputed with a different formula. The one new
idea is "matched months": a basket mixes funds with different inception dates, and only
months every member has a return for can be correlated, blended or compared.
"""

from __future__ import annotations

from dataclasses import dataclass

import pandas as pd

from ..quality import Metric, Reason
from .risk import MIN_OBS_DEFAULT, Capture, capture_ratios, max_drawdown, sharpe, volatility

# The same 3-year floor every other risk metric in this app refuses below.
MIN_OBS = MIN_OBS_DEFAULT


def matched_returns(returns: dict[str, pd.Series]) -> pd.DataFrame:
    """Monthly returns of every basket member, restricted to months all of them have."""
    cleaned = {code: pd.to_numeric(s, errors="coerce").dropna() for code, s in returns.items()}
    return pd.concat(cleaned, axis=1, sort=True).dropna()


def _nav_from_returns(returns: pd.Series) -> pd.Series:
    return (1.0 + returns).cumprod() * 100.0


def _full_period_metrics(
    r: pd.Series, rf_monthly: float, min_obs: int
) -> tuple[Metric, Metric, Metric, Metric]:
    """CAGR, volatility, Sharpe and max drawdown over a series' whole matched window.

    Unlike the snapshot's fixed 1/3/5/10y horizons, a basket's common window is
    whatever length the intersection of its members happens to be, so CAGR is
    compounded start-to-end rather than anchored to a nominal horizon.
    """
    n = len(r)
    nav = _nav_from_returns(r)
    years = n / 12.0
    cagr = Metric(float(nav.iloc[-1] / 100.0) ** (1.0 / years) - 1.0, n)
    return cagr, volatility(r, min_obs), sharpe(r, rf_monthly, min_obs), max_drawdown(nav).metric


@dataclass(frozen=True, slots=True)
class ComponentResult:
    """One basket member's own full-window metrics, alongside how the blend used it."""

    weight: float
    cagr: Metric
    volatility: Metric
    sharpe: Metric
    max_drawdown: Metric
    capture_vs_blended: Capture


@dataclass(frozen=True, slots=True)
class BasketResult:
    matched_months: int
    correlation: pd.DataFrame
    blended_returns: pd.Series
    cagr: Metric
    volatility: Metric
    sharpe: Metric
    max_drawdown: Metric
    diversification_benefit: Metric
    components: dict[str, ComponentResult]


def compute_basket(
    returns: dict[str, pd.Series],
    weights: dict[str, float],
    rf_monthly: float,
    min_obs: int = MIN_OBS,
) -> BasketResult | None:
    """None means insufficient_history: fewer than `min_obs` months shared by every member."""
    matched = matched_returns(returns)
    n = len(matched)
    if n < min_obs:
        return None
    codes = list(matched.columns)
    correlation = matched.corr()
    w = pd.Series(weights, dtype=float).reindex(codes)
    blended = matched.mul(w, axis=1).sum(axis=1)
    cagr, vol, shp, mdd = _full_period_metrics(blended, rf_monthly, min_obs)

    components: dict[str, ComponentResult] = {}
    component_vols: dict[str, float | None] = {}
    for code in codes:
        c_cagr, c_vol, c_shp, c_mdd = _full_period_metrics(matched[code], rf_monthly, min_obs)
        component_vols[code] = c_vol.value
        components[code] = ComponentResult(
            weight=float(w[code]),
            cagr=c_cagr,
            volatility=c_vol,
            sharpe=c_shp,
            max_drawdown=c_mdd,
            capture_vs_blended=capture_ratios(blended, matched[code], min_obs),
        )

    known_vols = {c: v for c, v in component_vols.items() if v is not None}
    if vol.value is None or len(known_vols) != len(codes):
        benefit = Metric.missing(Reason.INSUFFICIENT_OBSERVATIONS, n)
    else:
        weighted_avg_vol = sum(float(w[c]) * known_vols[c] for c in codes)
        benefit = Metric(weighted_avg_vol - vol.value, n)

    return BasketResult(
        matched_months=n,
        correlation=correlation,
        blended_returns=blended,
        cagr=cagr,
        volatility=vol,
        sharpe=shp,
        max_drawdown=mdd,
        diversification_benefit=benefit,
        components=components,
    )
