"""Returns-based style analysis: the fit must respect its constraints and admit its limits."""

from __future__ import annotations

from itertools import pairwise

import numpy as np
import pandas as pd
import pytest

from mf_analytics.metrics.exposure import (
    MAX_FACTORS,
    ROLLING_WINDOW_MONTHS,
    Exposure,
    rolling_style_exposure,
    style_drift,
    style_exposure,
    weight_turnover,
)
from mf_analytics.quality import Reason

MONTHS = 60


def factors(
    seed: int = 7, columns: tuple[str, ...] = ("large", "mid", "small"), periods: int = MONTHS
) -> pd.DataFrame:
    rng = np.random.default_rng(seed)
    index = pd.date_range("2020-01-31", periods=periods, freq="ME")
    return pd.DataFrame(
        {name: rng.normal(0.01, 0.05, periods) for name in columns},
        index=index,
    )


def test_a_fund_that_is_a_known_blend_recovers_that_blend() -> None:
    f = factors()
    fund = 0.7 * f["large"] + 0.3 * f["small"]

    result = style_exposure(fund, f)

    assert result.r_squared == pytest.approx(1.0)
    assert result.weights["large"] == pytest.approx(0.7, abs=1e-6)
    assert result.weights["small"] == pytest.approx(0.3, abs=1e-6)
    # A factor the fund has no exposure to is left out, not reported at roughly zero.
    assert "mid" not in result.weights


def test_a_pure_single_factor_fund_gets_all_of_its_weight() -> None:
    f = factors()

    result = style_exposure(f["mid"], f)

    assert result.weights == pytest.approx({"mid": 1.0}, abs=1e-6)


def test_weights_are_never_negative_and_always_sum_to_one() -> None:
    """A fund that is short a factor still has to be described as a long-only mix."""
    f = factors()
    fund = 1.6 * f["large"] - 0.6 * f["small"]

    result = style_exposure(fund, f)

    assert all(w >= 0 for w in result.weights.values())
    assert sum(result.weights.values()) == pytest.approx(1.0, abs=1e-6)


def test_too_little_shared_history_is_refused_with_a_reason() -> None:
    f = factors()

    result = style_exposure(f["large"].iloc[:10], f, min_months=24)

    assert result.weights == {}
    assert result.r_squared is None
    assert result.reason == Reason.INSUFFICIENT_OBSERVATIONS
    assert result.months == 10


def test_no_factor_series_loaded_is_refused_with_a_reason() -> None:
    result = style_exposure(factors()["large"], pd.DataFrame())

    assert result == Exposure(reason=Reason.BENCHMARK_UNAVAILABLE)


def test_only_months_present_in_every_series_are_used() -> None:
    """A short factor must shorten the window, never be padded or dropped silently."""
    f = factors()
    f.loc[f.index[:40], "small"] = np.nan

    result = style_exposure(f["large"], f, min_months=12)

    assert result.months == 20
    assert result.first_date == f.index[40]


def test_the_fit_reports_how_much_it_explains() -> None:
    f = factors()
    rng = np.random.default_rng(1)
    noisy = f["large"] + pd.Series(rng.normal(0, 0.05, MONTHS), index=f.index)

    result = style_exposure(noisy, f)

    assert result.r_squared is not None
    assert 0.0 < result.r_squared < 1.0


def test_too_many_factors_is_a_programming_error_not_a_slow_answer() -> None:
    names = tuple(f"f{i}" for i in range(MAX_FACTORS + 1))

    with pytest.raises(ValueError, match="At most"):
        style_exposure(factors(columns=names)["f0"], factors(columns=names))


def test_a_fund_the_basis_cannot_explain_gets_no_weights_at_all() -> None:
    """A US fund fitted to Indian indices must refuse, not invent a plausible-looking mix."""
    f = factors()
    rng = np.random.default_rng(99)
    unrelated = pd.Series(rng.normal(0.01, 0.05, MONTHS), index=f.index)

    result = style_exposure(unrelated, f)

    assert result.weights == {}
    assert result.reason == Reason.STYLE_FIT_TOO_WEAK
    # The fit quality is still reported, so the page can say how badly it failed.
    assert result.r_squared is not None
    assert result.r_squared < 0.5


def test_fixed_blend_gives_rolling_windows_that_barely_move() -> None:
    """A fund that never changes its mix should show near-zero drift throughout."""
    f = factors(periods=96)
    fund = 0.5 * f["large"] + 0.5 * f["small"]

    windows = rolling_style_exposure(fund, f)

    assert len(windows) == 96 - ROLLING_WINDOW_MONTHS + 1
    fitted = [w for w in windows if w.reason is None]
    assert len(fitted) == len(windows)
    turnovers = [weight_turnover(a, b) for a, b in pairwise(fitted)]
    assert max(turnovers) < 0.02

    drift = style_drift(windows)
    assert drift.value == pytest.approx(0.0, abs=0.02)
    assert drift.reason is None


def test_switching_basis_halfway_spikes_drift_only_at_the_switch() -> None:
    """Enough history either side of the switch that most windows never touch it."""
    f = factors(periods=120)
    switch = 60
    fund = pd.concat([f["large"].iloc[:switch], f["small"].iloc[switch:]])

    windows = rolling_style_exposure(fund, f)
    fitted = [w for w in windows if w.reason is None]
    turnovers = [weight_turnover(a, b) for a, b in pairwise(fitted)]

    # A window wholly before or wholly after the switch is a single, unchanging
    # factor - the boring windows that must stay near zero.
    settled = [t for t in turnovers if t < 0.05]
    spiking = [t for t in turnovers if t >= 0.05]
    assert len(settled) >= 2 * ROLLING_WINDOW_MONTHS - 4
    assert spiking
    assert max(turnovers) > 0.15

    drift = style_drift(windows)
    assert drift.value is not None
    assert drift.value > 0.0


def test_a_window_below_the_r_squared_floor_is_omitted_not_carried_forward() -> None:
    f = factors(periods=ROLLING_WINDOW_MONTHS + 2)
    rng = np.random.default_rng(99)
    noise = pd.Series(rng.normal(0.01, 0.05, len(f)), index=f.index)

    windows = rolling_style_exposure(noise, f)

    assert len(windows) == 3
    for w in windows:
        assert w.weights == {}
        assert w.reason == Reason.STYLE_FIT_TOO_WEAK

    drift = style_drift(windows)
    assert drift.value is None
    assert drift.reason == Reason.INSUFFICIENT_WINDOWS
    assert drift.n_obs == 0


def test_no_basis_gives_no_windows() -> None:
    assert rolling_style_exposure(factors()["large"], pd.DataFrame()) == []


def test_fewer_than_two_fitted_windows_refuses_a_drift_figure() -> None:
    f = factors()
    fund = f["large"]
    one_window = rolling_style_exposure(fund, f)[:1]

    drift = style_drift(one_window)

    assert drift.value is None
    assert drift.reason == Reason.INSUFFICIENT_WINDOWS
