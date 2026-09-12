"""Risk and risk-adjusted metrics against hand-computed values."""

from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from mf_analytics.metrics.risk import (
    alpha_beta,
    calmar,
    downside_deviation,
    information_ratio,
    max_drawdown,
    sharpe,
    sortino,
    tracking_error,
    volatility,
)
from mf_analytics.quality import Metric, Reason

SQRT12 = np.sqrt(12.0)


def series(values, start="2020-01-31"):
    return pd.Series(values, index=pd.date_range(start, periods=len(values), freq="ME"))


@pytest.fixture
def returns(rng):
    return series(rng.normal(0.01, 0.04, 60))


def test_volatility_matches_manual_formula(returns):
    result = volatility(returns)
    assert result.value == pytest.approx(returns.std(ddof=1) * SQRT12)
    assert result.n_obs == 60


def test_sharpe_matches_manual_formula(returns):
    rf = 0.005
    expected = (returns - rf).mean() / returns.std(ddof=1) * SQRT12
    assert sharpe(returns, rf).value == pytest.approx(expected)


def test_sharpe_null_on_zero_variance():
    flat = series([0.01] * 30)
    result = sharpe(flat, 0.005)
    assert result.value is None
    assert result.reason == Reason.ZERO_DENOMINATOR


def test_sharpe_requires_minimum_observations():
    result = sharpe(series([0.01] * 12), 0.005, min_obs=24)
    assert result.value is None
    assert result.reason == Reason.INSUFFICIENT_OBSERVATIONS


def test_downside_deviation_counts_only_shortfalls_but_scales_to_the_full_sample(returns):
    rf = 0.005
    below = returns[returns < rf] - rf
    expected = np.sqrt((below**2).sum() / (len(returns) - 1)) * SQRT12
    assert downside_deviation(returns, rf).value == pytest.approx(expected)


def test_downside_deviation_never_exceeds_total_volatility(returns):
    """It is read next to volatility, so it has to be on the same scale."""
    assert downside_deviation(returns, 0.005).value <= volatility(returns).value


def test_sortino_matches_manual_formula(returns):
    rf = 0.005
    dd = downside_deviation(returns, rf).value / SQRT12
    expected = (returns - rf).mean() / dd * SQRT12
    assert sortino(returns, rf).value == pytest.approx(expected)


def test_sortino_null_without_downside_observations():
    always_up = series(np.linspace(0.02, 0.05, 30))
    result = sortino(always_up, 0.005)
    assert result.value is None
    assert result.reason == Reason.NO_DOWNSIDE


def test_tracking_error_matches_manual_formula(rng):
    fund = series(rng.normal(0.012, 0.05, 48))
    bench = series(rng.normal(0.010, 0.045, 48))
    expected = (fund - bench).std(ddof=1) * SQRT12
    assert tracking_error(fund, bench).value == pytest.approx(expected)


def test_information_ratio_known_values():
    """Constant active return of 20 bps with zero dispersion has no defined IR."""
    fund = series([0.02] * 36)
    bench = series([0.018] * 36)
    assert information_ratio(fund, bench).reason == Reason.ZERO_DENOMINATOR

    active = np.array([0.01, -0.01] * 18)
    fund2 = series(bench.to_numpy() + active)
    expected = active.mean() / active.std(ddof=1) * SQRT12
    assert information_ratio(fund2, bench).value == pytest.approx(expected)


def test_information_ratio_uses_only_overlapping_months(rng):
    bench = series(rng.normal(0.01, 0.04, 48))
    fund = bench.iloc[12:] + 0.002
    result = information_ratio(fund, bench, min_obs=24)
    assert result.n_obs == 36


def test_alpha_beta_recover_synthetic_regression():
    bench = series(np.linspace(-0.05, 0.06, 60))
    rf = 0.005
    true_beta, true_alpha_monthly = 1.25, 0.002
    fund = rf + true_alpha_monthly + true_beta * (bench - rf)
    reg = alpha_beta(fund, bench, rf)
    assert reg.beta.value == pytest.approx(true_beta, rel=1e-9)
    assert reg.alpha.value == pytest.approx((1 + true_alpha_monthly) ** 12 - 1, rel=1e-9)
    assert reg.r_squared.value == pytest.approx(1.0, abs=1e-9)


def test_alpha_beta_null_when_benchmark_is_flat():
    bench = series([0.01] * 36)
    fund = series(np.linspace(0.0, 0.03, 36))
    reg = alpha_beta(fund, bench, 0.005)
    assert reg.beta.value is None
    assert reg.beta.reason == Reason.ZERO_DENOMINATOR


def test_max_drawdown_finds_peak_and_trough():
    nav = series([100, 120, 90, 60, 80, 150])
    result = max_drawdown(nav)
    assert result.metric.value == pytest.approx(60 / 120 - 1)
    assert result.peak_date == nav.index[1]
    assert result.trough_date == nav.index[3]


def test_max_drawdown_is_zero_for_monotonic_series():
    assert max_drawdown(series([100, 101, 102, 103])).metric.value == pytest.approx(0.0)


def test_calmar_divides_cagr_by_absolute_drawdown():
    assert calmar(Metric(0.18, 60), Metric(-0.30, 60)).value == pytest.approx(0.6)
    assert calmar(Metric(0.18, 60), Metric(0.0, 60)).reason == Reason.ZERO_DENOMINATOR
    assert calmar(Metric.missing(Reason.INSUFFICIENT_HISTORY), Metric(-0.3, 60)).value is None


def _closed_form_alpha_tstat(fund: pd.Series, bench: pd.Series, rf: float) -> tuple[float, int]:
    """Independent OLS reference: not the code under test, hand-built from the textbook formula."""
    y = (fund - rf).to_numpy(dtype=float)
    x = (bench - rf).to_numpy(dtype=float)
    n = len(x)
    xbar = x.mean()
    sxx = float(((x - xbar) ** 2).sum())
    slope = float(((x - xbar) * (y - y.mean())).sum() / sxx)
    intercept = float(y.mean() - slope * xbar)
    resid = y - (intercept + slope * x)
    dof = n - 2
    sigma2 = float((resid**2).sum()) / dof
    se_intercept = np.sqrt(sigma2 * (1.0 / n + xbar**2 / sxx))
    return intercept / se_intercept, dof


def test_alpha_tstat_matches_closed_form_ols_formula(rng):
    bench = series(rng.normal(0.01, 0.04, 60))
    rf = 0.004
    true_beta, true_alpha_monthly, noise_sd = 0.9, 0.0015, 0.01
    noise = rng.normal(0.0, noise_sd, 60)
    fund = rf + true_alpha_monthly + true_beta * (bench - rf) + noise

    reg = alpha_beta(fund, bench, rf)
    expected_t, expected_dof = _closed_form_alpha_tstat(fund, bench, rf)

    assert reg.alpha_tstat.value == pytest.approx(expected_t, rel=1e-9)
    assert reg.alpha_pvalue.value is not None
    assert 0.0 <= reg.alpha_pvalue.value <= 1.0
    # A two-sided test against a t distribution with `expected_dof` degrees of
    # freedom: sanity-check against the normal approximation, which converges
    # to the same answer once dof is this large.
    from math import erf

    z = abs(expected_t)
    normal_p = 2.0 * (1.0 - 0.5 * (1.0 + erf(z / np.sqrt(2.0))))
    assert reg.alpha_pvalue.value == pytest.approx(normal_p, abs=0.02)
    assert expected_dof == reg.beta.n_obs - 2


def test_alpha_tstat_null_on_perfect_fit():
    bench = series(np.linspace(-0.05, 0.06, 60))
    rf = 0.005
    fund = rf + 0.002 + 1.25 * (bench - rf)
    reg = alpha_beta(fund, bench, rf)
    assert reg.alpha_tstat.value is None
    assert reg.alpha_tstat.reason == Reason.ZERO_DENOMINATOR
    assert reg.alpha_pvalue.value is None


def test_alpha_pvalue_false_positive_rate_on_pure_noise(rng):
    """True alpha is exactly zero here, so p < 0.05 should fire on ~5% of funds by chance."""
    n_funds, n_months = 3000, 60
    rf = 0.0
    hits = 0
    for _ in range(n_funds):
        bench = series(rng.normal(0.01, 0.04, n_months))
        # Zero-mean excess return and no relation to the benchmark: true alpha and
        # beta are both exactly zero, so any "significant" alpha found is a
        # false positive by construction.
        fund = series(rng.normal(0.0, 0.04, n_months))
        reg = alpha_beta(fund, bench, rf)
        if reg.alpha_pvalue.value is not None and reg.alpha_pvalue.value < 0.05:
            hits += 1
    share = hits / n_funds
    assert 0.03 <= share <= 0.07


def test_a_thin_overlap_is_not_reported_as_no_overlap():
    """23 shared months against a 24-month minimum is a thin sample, not a disjoint one.

    Both cases used to carry `no_overlapping_observations`, which reads as "these
    series never meet" and sent a reader looking for a mapping bug that was not there.
    """
    import pandas as pd

    from mf_analytics.metrics.risk import alpha_beta, information_ratio, tracking_error
    from mf_analytics.quality import Reason

    idx = pd.date_range("2024-01-31", periods=23, freq="ME")
    fund = pd.Series([0.01] * 23, index=idx)
    bench = pd.Series([0.008] * 23, index=idx)

    assert tracking_error(fund, bench, min_obs=24).reason == Reason.INSUFFICIENT_OBSERVATIONS
    assert information_ratio(fund, bench, min_obs=24).reason == Reason.INSUFFICIENT_OBSERVATIONS
    assert alpha_beta(fund, bench, 0.0, min_obs=24).alpha.reason == Reason.INSUFFICIENT_OBSERVATIONS


def test_genuinely_disjoint_series_still_say_no_overlap():
    import pandas as pd

    from mf_analytics.metrics.risk import tracking_error
    from mf_analytics.quality import Reason

    fund = pd.Series([0.01] * 30, index=pd.date_range("2020-01-31", periods=30, freq="ME"))
    bench = pd.Series([0.01] * 30, index=pd.date_range("2024-01-31", periods=30, freq="ME"))
    assert tracking_error(fund, bench, min_obs=24).reason == Reason.NO_OVERLAP
