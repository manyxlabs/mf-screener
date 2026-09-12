"""After-tax and after-exit-load returns: orientation lookup, LTCG/STCG split, slab treatment."""

from __future__ import annotations

import pytest

from mf_analytics.config import Settings
from mf_analytics.metrics import tax
from mf_analytics.metrics.series import to_monthly
from mf_analytics.quality import Metric

from .conftest import constant_growth_nav


def _settings(**overrides: float) -> Settings:
    """Explicit rates, so the test does not depend on whatever .env happens to hold."""
    return Settings(
        mf_ltcg_rate=overrides.get("mf_ltcg_rate", 0.125),
        mf_ltcg_exemption=overrides.get("mf_ltcg_exemption", 125_000.0),
        mf_stcg_rate=overrides.get("mf_stcg_rate", 0.20),
        mf_lt_holding_months=int(overrides.get("mf_lt_holding_months", 12)),
        mf_slab_rate=overrides.get("mf_slab_rate", 0.30),
    )


@pytest.mark.parametrize(
    ("category", "sub_category", "expected"),
    [
        ("Equity Scheme", "Flexi Cap Fund", tax.EQUITY_ORIENTED),
        ("Debt Scheme", "Liquid Fund", tax.DEBT_ORIENTED),
        ("Hybrid Scheme", "Aggressive Hybrid Fund", tax.EQUITY_ORIENTED),
        ("Hybrid Scheme", "Arbitrage Fund", tax.EQUITY_ORIENTED),
        ("Hybrid Scheme", "Equity Savings", tax.EQUITY_ORIENTED),
        ("Hybrid Scheme", "Conservative Hybrid Fund", tax.DEBT_ORIENTED),
        ("Hybrid Scheme", "Balanced Hybrid Fund", tax.DEBT_ORIENTED),
        # Mandate lets equity float across 65%, so it is never guessed.
        ("Hybrid Scheme", "Balanced Advantage Fund", None),
        ("Hybrid Scheme", "Multi Asset Allocation Fund", None),
        ("Other Scheme", "Index Funds", None),
        ("Other Scheme", "Gold ETF", None),
    ],
)
def test_orientation(category: str, sub_category: str, expected: str | None) -> None:
    assert tax.orientation(category, sub_category) == expected


def test_lumpsum_equity_ltcg_hand_computed() -> None:
    """A 5-year equity lumpsum with a known gain reproduces a hand-computed net figure."""
    settings = _settings()
    amount = 1_000_000.0  # large enough that the gain clears the LTCG exemption
    years = 5.0
    gross_rate = 0.15
    gross = Metric(gross_rate, 60)

    result = tax.after_tax_lumpsum(
        gross, years, "Equity Scheme", "Flexi Cap Fund", settings, amount
    )

    final_amount = amount * (1.0 + gross_rate) ** years
    gain = final_amount - amount
    assert gain > settings.mf_ltcg_exemption  # otherwise this test proves nothing about the tax
    expected_tax = (gain - settings.mf_ltcg_exemption) * settings.mf_ltcg_rate
    expected_net_amount = amount + gain - expected_tax
    expected_rate = (expected_net_amount / amount) ** (1.0 / years) - 1.0

    assert result.orientation == tax.EQUITY_ORIENTED
    assert result.after_tax.value is not None
    assert result.after_tax.value == pytest.approx(expected_rate, abs=1e-9)
    # Sanity: tax paid strictly reduces the annualised return below the gross rate.
    assert gross.value is not None
    assert result.after_tax.value < gross.value


def test_lumpsum_equity_short_term_uses_stcg_no_exemption() -> None:
    settings = _settings()
    amount = 100_000.0
    years = 0.5  # 6 months: below MF_LT_HOLDING_MONTHS
    gross_rate = 0.30
    gross = Metric(gross_rate, 6)

    result = tax.after_tax_lumpsum(
        gross, years, "Equity Scheme", "Flexi Cap Fund", settings, amount
    )

    final_amount = amount * (1.0 + gross_rate) ** years
    gain = final_amount - amount
    expected_tax = gain * settings.mf_stcg_rate  # no exemption for STCG
    expected_rate = ((amount + gain - expected_tax) / amount) ** (1.0 / years) - 1.0
    assert result.after_tax.value == pytest.approx(expected_rate, abs=1e-9)


def test_lumpsum_debt_uses_slab_rate_regardless_of_holding_period() -> None:
    settings = _settings()
    amount = 100_000.0
    years = 5.0
    gross_rate = 0.07
    gross = Metric(gross_rate, 60)

    result = tax.after_tax_lumpsum(gross, years, "Debt Scheme", "Liquid Fund", settings, amount)

    final_amount = amount * (1.0 + gross_rate) ** years
    gain = final_amount - amount
    expected_tax = gain * settings.mf_slab_rate
    expected_rate = ((amount + gain - expected_tax) / amount) ** (1.0 / years) - 1.0

    assert result.orientation == tax.DEBT_ORIENTED
    assert result.after_tax.value == pytest.approx(expected_rate, abs=1e-9)


def test_lumpsum_undetermined_orientation_is_null_with_reason() -> None:
    settings = _settings()
    gross = Metric(0.12, 60)
    result = tax.after_tax_lumpsum(gross, 5.0, "Hybrid Scheme", "Balanced Advantage Fund", settings)
    assert result.orientation is None
    assert result.after_tax.value is None
    assert result.after_tax.reason == tax.TAX_TREATMENT_UNDETERMINED


def test_lumpsum_missing_gross_propagates_reason_not_guessed() -> None:
    settings = _settings()
    missing = Metric.missing("insufficient_history")
    result = tax.after_tax_lumpsum(missing, 5.0, "Equity Scheme", "Flexi Cap Fund", settings)
    assert result.after_tax.value is None
    assert result.after_tax.reason == "insufficient_history"


@pytest.mark.parametrize(
    ("category", "sub_category"),
    [
        ("Equity Scheme", "Flexi Cap Fund"),
        ("Debt Scheme", "Liquid Fund"),
        ("Hybrid Scheme", "Balanced Advantage Fund"),
    ],
)
def test_exit_load_always_null_never_zero(category: str, sub_category: str) -> None:
    """Until T3.2, the after-load term is null with a named reason - never a computed zero."""
    settings = _settings()
    gross = Metric(0.12, 60)
    result = tax.after_tax_lumpsum(gross, 5.0, category, sub_category, settings)
    assert result.after_tax_and_load.value is None
    assert result.after_tax_and_load.reason == tax.EXIT_LOAD_NOT_PUBLISHED


def test_assumptions_name_the_rates_and_flag_slab_as_holder_assumption() -> None:
    settings = _settings(mf_slab_rate=0.30)
    facts = tax.assumptions(settings)
    assert facts["ltcg_rate"] == 0.125
    assert facts["slab_rate"] == 0.30
    assert "holder" in str(facts["slab_rate_note"]).lower()


def test_sip_equity_mixed_holding_periods_reduces_gross_return() -> None:
    """A 5y SIP mixes LTCG installments with STCG ones from its last 12 months.

    The series is monotonically rising, so every installment shows a gain and every
    gain is taxed one way or the other - the after-tax rate must come in below gross.
    """
    settings = _settings()
    monthly = to_monthly(constant_growth_nav("2019-01-31", 12 * 6, 0.01))
    result = tax.after_tax_sip(monthly, 5, "Equity Scheme", "Flexi Cap Fund", settings)
    assert result.orientation == tax.EQUITY_ORIENTED
    assert result.gross.value is not None
    assert result.after_tax.value is not None
    # Tax on a positive gain strictly reduces the annualised return.
    assert result.after_tax.value < result.gross.value
    assert result.after_tax_and_load.reason == tax.EXIT_LOAD_NOT_PUBLISHED


def test_sip_debt_taxes_every_installment_at_slab_rate() -> None:
    settings = _settings()
    monthly = to_monthly(constant_growth_nav("2019-01-31", 12 * 6, 0.005))
    result = tax.after_tax_sip(monthly, 5, "Debt Scheme", "Liquid Fund", settings)
    assert result.orientation == tax.DEBT_ORIENTED
    assert result.after_tax.value is not None
    assert result.gross.value is not None
    assert result.after_tax.value < result.gross.value


def test_sip_undetermined_orientation_is_null_with_reason() -> None:
    settings = _settings()
    monthly = to_monthly(constant_growth_nav("2019-01-31", 12 * 6, 0.01))
    result = tax.after_tax_sip(monthly, 5, "Hybrid Scheme", "Multi Asset Allocation Fund", settings)
    assert result.orientation is None
    assert result.after_tax.value is None
    assert result.after_tax.reason == tax.TAX_TREATMENT_UNDETERMINED
    # The gross figure is still computable and shown even when tax treatment is not.
    assert result.gross.value is not None


def test_sip_insufficient_history_propagates_gross_reason() -> None:
    settings = _settings()
    # far short of 12 contributions
    monthly = to_monthly(constant_growth_nav("2025-01-31", 3, 0.01))
    result = tax.after_tax_sip(monthly, 5, "Equity Scheme", "Flexi Cap Fund", settings)
    assert result.gross.value is None
    assert result.after_tax.value is None
    assert result.after_tax.reason == result.gross.reason
