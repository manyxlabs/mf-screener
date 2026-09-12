"""T1.6: correlation matrix and basket analysis.

Two layers: `compute_basket` against hand-verifiable synthetic series (the acceptance
criteria in plan.md), and the `POST /basket` endpoint wired to a small in-memory store.
"""

from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

from mf_analytics.metrics.basket import compute_basket
from mf_analytics.quality import Reason

pytest.importorskip("fastapi")

RF_MONTHLY = 0.0

MIN_OBS = 24


def series(values, start="2015-01-31"):
    return pd.Series(values, index=pd.date_range(start, periods=len(values), freq="ME"))


@pytest.fixture
def fund_a(rng):
    return series(rng.normal(0.01, 0.04, 60))


def _orthogonal_to(base: pd.Series, rng: np.random.Generator) -> pd.Series:
    """A series with the same length as `base` and exactly zero sample correlation to it."""
    n = len(base)
    x = base.to_numpy(dtype=float) - base.mean()
    y = rng.normal(0.0, 1.0, n)
    y = y - y.mean()
    # Gram-Schmidt: remove the component of y along x, so corr(x, y) is 0 to float precision.
    y = y - (y @ x) / (x @ x) * x
    return pd.Series(0.01 + 0.03 * y / y.std(ddof=1), index=base.index)


# --- compute_basket: acceptance criteria straight from plan.md -----------------------


def test_single_fund_basket_reproduces_its_own_metrics_exactly(fund_a):
    result = compute_basket({"F1": fund_a}, {"F1": 1.0}, RF_MONTHLY, min_obs=MIN_OBS)
    assert result is not None
    assert result.matched_months == len(fund_a)

    # Independently derived, not by calling the same helper the implementation calls.
    expected_cagr = (float(np.prod(1.0 + fund_a.to_numpy()))) ** (12.0 / len(fund_a)) - 1.0
    expected_vol = float(fund_a.std(ddof=1) * np.sqrt(12.0))
    expected_sharpe = float((fund_a - RF_MONTHLY).mean() / fund_a.std(ddof=1) * np.sqrt(12.0))

    assert result.cagr.value == pytest.approx(expected_cagr)
    assert result.volatility.value == pytest.approx(expected_vol)
    assert result.sharpe.value == pytest.approx(expected_sharpe)

    component = result.components["F1"]
    assert component.cagr.value == pytest.approx(result.cagr.value)
    assert component.volatility.value == pytest.approx(result.volatility.value)
    assert component.max_drawdown.value == pytest.approx(result.max_drawdown.value)
    # Capture of a series against itself is definitionally total, both directions.
    assert component.capture_vs_blended.up.value == pytest.approx(1.0)
    assert component.capture_vs_blended.down.value == pytest.approx(1.0)
    assert result.diversification_benefit.value == pytest.approx(0.0, abs=1e-9)


def test_two_perfectly_correlated_funds_give_zero_diversification_benefit(fund_a):
    fund_b = fund_a * 1.6 + 0.001  # an affine rescale: correlation 1.0, different vol
    result = compute_basket(
        {"F1": fund_a, "F2": fund_b}, {"F1": 0.5, "F2": 0.5}, RF_MONTHLY, min_obs=MIN_OBS
    )
    assert result is not None
    assert result.correlation.loc["F1", "F2"] == pytest.approx(1.0, abs=1e-9)
    assert result.diversification_benefit.value == pytest.approx(0.0, abs=1e-9)


def test_two_uncorrelated_funds_give_the_closed_form_diversification_benefit(rng, fund_a):
    fund_b = _orthogonal_to(fund_a, rng)
    weights = {"F1": 0.5, "F2": 0.5}
    result = compute_basket({"F1": fund_a, "F2": fund_b}, weights, RF_MONTHLY, min_obs=MIN_OBS)
    assert result is not None
    assert result.correlation.loc["F1", "F2"] == pytest.approx(0.0, abs=1e-9)

    vol_a = result.components["F1"].volatility.value
    vol_b = result.components["F2"].volatility.value
    weighted_avg_vol = 0.5 * vol_a + 0.5 * vol_b
    # Closed form for zero correlation: blended variance is the sum of the weighted variances.
    closed_form_blended_vol = float(np.sqrt((0.5 * vol_a) ** 2 + (0.5 * vol_b) ** 2))
    expected_benefit = weighted_avg_vol - closed_form_blended_vol

    assert result.volatility.value == pytest.approx(closed_form_blended_vol)
    assert result.diversification_benefit.value == pytest.approx(expected_benefit)
    assert result.diversification_benefit.value > 0.0


def test_basket_below_the_floor_is_null_with_insufficient_history(fund_a):
    short = fund_a.iloc[:10]
    result = compute_basket({"F1": short}, {"F1": 1.0}, RF_MONTHLY, min_obs=MIN_OBS)
    assert result is None


def test_matched_months_uses_only_the_overlap_across_members(fund_a):
    """A basket mixing a young and an old fund is scored on their common history only."""
    late_start = series(fund_a.to_numpy()[-30:], start=fund_a.index[-30])
    matched = compute_basket(
        {"F1": fund_a, "F2": late_start}, {"F1": 0.5, "F2": 0.5}, RF_MONTHLY, min_obs=MIN_OBS
    )
    assert matched is not None
    assert matched.matched_months == 30


# --- POST /basket: wiring, validation, and the null-with-reason contract -------------

NOW = datetime.now(UTC).replace(tzinfo=None)


@pytest.fixture
def client(tmp_path: Path):
    from mf_analytics.config import Settings
    from mf_analytics.db import connect, init_schema

    settings = Settings(
        mf_data_dir=tmp_path / "data", mf_duckdb_path=tmp_path / "data" / "processed" / "b.duckdb"
    )
    settings.ensure_dirs()

    rng = np.random.default_rng(4200)
    codes = {
        "B01": 60,  # enough history to clear the floor
        "B02": 60,
        "B03": 8,  # too little history on its own
    }
    master_rows = []
    returns_rows = []
    for code, months in codes.items():
        dates = pd.date_range("2018-01-31", periods=months, freq="ME")
        r = rng.normal(0.01, 0.04, months)
        master_rows.append(
            {
                "scheme_code": code,
                "scheme_name": f"{code} Fund - Direct - Growth",
                "amc": "Test AMC",
                "clean_sub_category": "Flexi Cap Fund",
                "clean_plan": "Direct",
                "clean_option": "Growth",
                "is_active": True,
                "source": "test",
                "ingested_at": NOW,
            }
        )
        for d, ret in zip(dates, r, strict=True):
            returns_rows.append(
                {"scheme_code": code, "date": d.date(), "monthly_return": float(ret)}
            )

    master = pd.DataFrame(master_rows)
    monthly = pd.DataFrame(returns_rows)
    with connect(settings) as con:
        init_schema(con)
        con.register("master", master)
        con.execute(
            "INSERT INTO scheme_master (scheme_code, scheme_name, amc, clean_sub_category, "
            "clean_plan, clean_option, is_active, source, ingested_at) "
            "SELECT scheme_code, scheme_name, amc, clean_sub_category, clean_plan, clean_option, "
            "is_active, source, ingested_at FROM master"
        )
        con.unregister("master")
        con.register("monthly", monthly)
        con.execute(
            "INSERT INTO monthly_returns (scheme_code, date, monthly_return) "
            "SELECT scheme_code, date, monthly_return FROM monthly"
        )
        con.unregister("monthly")

    from fastapi.testclient import TestClient

    import mf_api.main as api_main
    from mf_api import store

    store.close_connection()
    api_main.settings = settings
    original = store.get_settings
    store.get_settings = lambda: settings  # type: ignore[assignment]
    try:
        with TestClient(api_main.app) as test_client:
            yield test_client
    finally:
        store.get_settings = original  # type: ignore[assignment]
        store.close_connection()


def test_basket_defaults_to_equal_weights(client):
    resp = client.post("/basket", json={"scheme_codes": ["B01", "B02"]})
    assert resp.status_code == 200
    payload = resp.json()
    assert payload["weights"] == {"B01": 0.5, "B02": 0.5}
    assert payload["matched_months"] == 60
    assert len(payload["correlation_matrix"]) == 2
    assert payload["blended"]["cagr"]["value"] is not None
    assert len(payload["components"]) == 2


def test_basket_accepts_explicit_weights_summing_to_one(client):
    resp = client.post("/basket", json={"scheme_codes": ["B01", "B02"], "weights": [0.3, 0.7]})
    assert resp.status_code == 200
    assert resp.json()["weights"] == {"B01": 0.3, "B02": 0.7}


def test_basket_rejects_weights_not_summing_to_one(client):
    resp = client.post("/basket", json={"scheme_codes": ["B01", "B02"], "weights": [0.3, 0.3]})
    assert resp.status_code == 422


def test_basket_rejects_more_than_ten_funds(client):
    resp = client.post("/basket", json={"scheme_codes": [f"B{i:02d}" for i in range(11)]})
    assert resp.status_code == 422


def test_basket_rejects_unknown_scheme_code(client):
    resp = client.post("/basket", json={"scheme_codes": ["B01", "NOPE"]})
    assert resp.status_code == 404


def test_basket_below_floor_is_null_with_named_reason(client):
    resp = client.post("/basket", json={"scheme_codes": ["B03"]})
    assert resp.status_code == 200
    payload = resp.json()
    assert "correlation_matrix" not in payload
    assert payload["reason"] == Reason.INSUFFICIENT_HISTORY
    assert payload["reason_description"]
    assert payload["matched_months"] == 8
