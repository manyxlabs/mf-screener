"""After-tax and after-exit-load returns: a display layer over an existing gross return.

Never stored as a ranking column and never joined into the snapshot - the applicable
rate depends on the holder's tax slab and holding intent, not on anything the fund
itself did. Every rate is read from `Settings`, so a rate change is a config change,
never a code change.

Orientation (equity- vs debt-oriented) is read off `clean_category` and
`clean_sub_category` and is never guessed: a Hybrid sub-category whose SEBI mandate
lets the equity share float across the 65% line - Balanced Advantage, Dynamic Asset
Allocation, Multi Asset Allocation - reports `tax_treatment_undetermined` instead of
picking a side.

Exit load (T3.2's `scheme_attributes.exit_load_pct` / `exit_load_period_days`) is a
caller-supplied fact, not something this module fetches: neither function here takes a
scheme code or opens a connection, so a caller with no exit load on hand simply omits
the two parameters and gets `exit_load_not_published`, never a load assumed to be zero.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Final

import numpy as np
import pandas as pd

from ..config import Settings
from ..quality import Metric
from .cashflow import NOT_BRACKETED, _solve_xirr, sip_xirr

EQUITY_ORIENTED: Final = "equity_oriented"
DEBT_ORIENTED: Final = "debt_oriented"

TAX_TREATMENT_UNDETERMINED: Final = "tax_treatment_undetermined"
EXIT_LOAD_NOT_PUBLISHED: Final = "exit_load_not_published"

REASON_DESCRIPTIONS: Final[dict[str, str]] = {
    TAX_TREATMENT_UNDETERMINED: (
        "Whether this scheme is equity-oriented for capital gains tax cannot be read off "
        "its category. Hybrid schemes whose mandate lets the equity share float across the "
        "65% line - Balanced Advantage, Dynamic Asset Allocation, Multi Asset Allocation - "
        "are not guessed into either treatment."
    ),
    EXIT_LOAD_NOT_PUBLISHED: (
        "No exit load is stored for this scheme, so the after-tax-and-load figure is "
        "withheld rather than assumed to be zero. A fund with an unpublished load may "
        "still be inside its load period."
    ),
}

# SEBI's mandated equity band for each Hybrid sub-category is what makes orientation
# readable off the label at all. Sub-categories left out below - Balanced Advantage,
# Dynamic Asset Allocation, Multi Asset Allocation - let equity float across the 65%
# line by mandate, so no category-only rule can place them without guessing.
_HYBRID_EQUITY_ORIENTED: Final = frozenset(
    {
        "Aggressive Hybrid Fund",  # SEBI mandate: 65-80% equity
        "Arbitrage Fund",  # runs a hedged equity book; taxed as equity-oriented
        "Equity Savings",  # SEBI mandate: minimum 65% equity, hedged plus unhedged
    }
)
_HYBRID_DEBT_ORIENTED: Final = frozenset(
    {
        "Conservative Hybrid Fund",  # SEBI mandate: 10-25% equity
        "Balanced Hybrid Fund",  # SEBI mandate: 40-60% equity
    }
)


def orientation(clean_category: str, clean_sub_category: str) -> str | None:
    """Equity- or debt-oriented for capital gains tax, or None if the category will not say."""
    if clean_category == "Equity Scheme":
        return EQUITY_ORIENTED
    if clean_category == "Debt Scheme":
        return DEBT_ORIENTED
    if clean_category == "Hybrid Scheme":
        if clean_sub_category in _HYBRID_EQUITY_ORIENTED:
            return EQUITY_ORIENTED
        if clean_sub_category in _HYBRID_DEBT_ORIENTED:
            return DEBT_ORIENTED
    return None


def assumptions(settings: Settings) -> dict[str, float | int | str]:
    """The named rates shown on screen, so the fund page never states a number silently."""
    return {
        "ltcg_rate": settings.mf_ltcg_rate,
        "ltcg_exemption": settings.mf_ltcg_exemption,
        "stcg_rate": settings.mf_stcg_rate,
        "lt_holding_months": settings.mf_lt_holding_months,
        "slab_rate": settings.mf_slab_rate,
        "slab_rate_note": (
            "The slab rate is an assumption about the holder's tax bracket, not a "
            "property of this fund. Debt-oriented gains are taxed at the holder's slab "
            "rate regardless of how long the units were held, for units acquired on or "
            "after 1 April 2023."
        ),
    }


@dataclass(frozen=True, slots=True)
class NetReturn:
    gross: Metric
    after_tax: Metric
    after_tax_and_load: Metric
    orientation: str | None
    assumptions: dict[str, float | int | str] = field(default_factory=dict)


def _equity_tax(gain: float, holding_months: float, settings: Settings) -> float:
    if holding_months >= settings.mf_lt_holding_months:
        return max(0.0, gain - settings.mf_ltcg_exemption) * settings.mf_ltcg_rate
    return max(0.0, gain) * settings.mf_stcg_rate


def _sip_tax(
    gain_per_installment: np.ndarray, holding_months: np.ndarray, orient: str, settings: Settings
) -> float:
    if orient == EQUITY_ORIENTED:
        is_lt = holding_months >= settings.mf_lt_holding_months
        lt_gain = float(gain_per_installment[is_lt].sum())
        st_gain = float(gain_per_installment[~is_lt].sum())
        return (
            max(0.0, lt_gain - settings.mf_ltcg_exemption) * settings.mf_ltcg_rate
            + max(0.0, st_gain) * settings.mf_stcg_rate
        )
    return max(0.0, float(gain_per_installment.sum())) * settings.mf_slab_rate


def _load_adjusted_gain(
    gain: float, amount: float, holding_days: float, exit_load_pct: float, load_period_days: float
) -> float:
    """Exit load is deducted from the redemption value itself, before the gain used
    for tax is known - a fund's SID quotes the load as a percentage of NAV taken at
    redemption, not as a charge on the gain."""
    if holding_days >= load_period_days:
        return gain
    return (amount + gain) * (1.0 - exit_load_pct) - amount


def after_tax_lumpsum(
    gross: Metric,
    years: float,
    clean_category: str,
    clean_sub_category: str,
    settings: Settings,
    amount: float = 100_000.0,
    exit_load_pct: float | None = None,
    exit_load_period_days: float | None = None,
) -> NetReturn:
    """Net-of-tax CAGR for a single investment of `amount` held for `years`.

    `amount` only sizes the LTCG exemption, which is a rupee threshold rather than a
    rate - the annualised result does not depend on it once the exemption is exhausted
    or irrelevant (debt, short-term equity).
    """
    orient = orientation(clean_category, clean_sub_category)
    facts = assumptions(settings)
    after_tax_and_load = Metric.missing(EXIT_LOAD_NOT_PUBLISHED)
    if gross.value is None:
        after_tax = Metric.missing(gross.reason or "insufficient_history", gross.n_obs)
        return NetReturn(gross, after_tax, after_tax_and_load, orient, facts)
    if orient is None:
        after_tax = Metric.missing(TAX_TREATMENT_UNDETERMINED, gross.n_obs)
        if exit_load_pct is not None:
            after_tax_and_load = Metric.missing(TAX_TREATMENT_UNDETERMINED, gross.n_obs)
        return NetReturn(gross, after_tax, after_tax_and_load, orient, facts)

    final_amount = amount * (1.0 + gross.value) ** years
    gain = final_amount - amount
    tax = (
        _equity_tax(gain, years * 12.0, settings)
        if orient == EQUITY_ORIENTED
        else max(0.0, gain) * settings.mf_slab_rate
    )
    net_amount = amount + gain - tax
    after_tax = Metric((net_amount / amount) ** (1.0 / years) - 1.0, gross.n_obs)

    if exit_load_pct is not None:
        loaded_gain = _load_adjusted_gain(
            gain, amount, years * 365.25, exit_load_pct, exit_load_period_days or 0.0
        )
        load_tax = (
            _equity_tax(loaded_gain, years * 12.0, settings)
            if orient == EQUITY_ORIENTED
            else max(0.0, loaded_gain) * settings.mf_slab_rate
        )
        net_after_load = (amount + loaded_gain) - load_tax
        after_tax_and_load = Metric((net_after_load / amount) ** (1.0 / years) - 1.0, gross.n_obs)
    return NetReturn(gross, after_tax, after_tax_and_load, orient, facts)


def after_tax_sip(
    monthly: pd.DataFrame,
    years: int,
    clean_category: str,
    clean_sub_category: str,
    settings: Settings,
    exit_load_pct: float | None = None,
    exit_load_period_days: float | None = None,
) -> NetReturn:
    """Net-of-tax XIRR for one unit invested at every month-end in the trailing window.

    Each installment carries its own holding period, so an equity-oriented SIP can mix
    LTCG and STCG installments inside one window, and - when an exit load applies - the
    most recent installments can still be inside the load period while older ones are
    past it; the exemption applies once, to the combined long-term gain, exactly as it
    would on a real tax return.
    """
    orient = orientation(clean_category, clean_sub_category)
    facts = assumptions(settings)
    after_tax_and_load = Metric.missing(EXIT_LOAD_NOT_PUBLISHED)
    gross = sip_xirr(monthly, years)
    if gross.value is None:
        after_tax = Metric.missing(gross.reason or "insufficient_observations", gross.n_obs)
        return NetReturn(gross, after_tax, after_tax_and_load, orient, facts)
    if orient is None:
        after_tax = Metric.missing(TAX_TREATMENT_UNDETERMINED, gross.n_obs)
        if exit_load_pct is not None:
            after_tax_and_load = Metric.missing(TAX_TREATMENT_UNDETERMINED, gross.n_obs)
        return NetReturn(gross, after_tax, after_tax_and_load, orient, facts)

    valid = monthly["nav"].dropna()
    valid = valid[valid > 0]
    end_label = valid.index[-1]
    start_bound = end_label - pd.DateOffset(years=years)
    window = valid.loc[(valid.index > start_bound) & (valid.index <= end_label)]

    units = 1.0 / window.to_numpy(dtype=float)
    last_nav = float(window.iloc[-1])
    redemption_values = units * last_nav
    gain_per_installment = redemption_values - 1.0
    holding_days = np.array([(end_label - d).days for d in window.index], dtype=float)
    holding_months = np.array(
        [(end_label.year - d.year) * 12 + (end_label.month - d.month) for d in window.index],
        dtype=float,
    )

    tax = _sip_tax(gain_per_installment, holding_months, orient, settings)
    total_redemption = float(redemption_values.sum())
    flows = -np.ones(len(window))
    flows[-1] = (total_redemption - tax) - 1.0
    days = (pd.DatetimeIndex(window.index) - window.index[0]).days.to_numpy(dtype=float)
    rate = _solve_xirr(days, flows)
    after_tax = (
        Metric.missing(NOT_BRACKETED, len(window)) if rate is None else Metric(rate, len(window))
    )

    if exit_load_pct is not None:
        period = exit_load_period_days or 0.0
        within_load = holding_days < period
        loaded_redemption = redemption_values * (1.0 - exit_load_pct)
        loaded_values = np.where(within_load, loaded_redemption, redemption_values)
        loaded_gain_per_installment = loaded_values - 1.0
        load_tax = _sip_tax(loaded_gain_per_installment, holding_months, orient, settings)
        total_loaded_redemption = float(loaded_values.sum())
        loaded_flows = -np.ones(len(window))
        loaded_flows[-1] = (total_loaded_redemption - load_tax) - 1.0
        loaded_rate = _solve_xirr(days, loaded_flows)
        after_tax_and_load = (
            Metric.missing(NOT_BRACKETED, len(window))
            if loaded_rate is None
            else Metric(loaded_rate, len(window))
        )
    return NetReturn(gross, after_tax, after_tax_and_load, orient, facts)
