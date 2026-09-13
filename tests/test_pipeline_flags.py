"""Data-quality flags and the persisted rolling series, on hand-built NAV histories."""

from __future__ import annotations

import json

import numpy as np
import pandas as pd
import pytest

from mf_analytics.classify import peer_group
from mf_analytics.config import ROLLING_HORIZONS, Settings
from mf_analytics.metrics import risk
from mf_analytics.metrics.series import calendar_year_returns, monthly_returns
from mf_analytics.pipeline import (
    CAPTURE_HORIZONS,
    MIN_CALENDAR_YEARS,
    MIN_RISK_OBS,
    NOT_RECOVERED,
    SchemeSeries,
    build_category_contexts,
    compute_scheme_row,
    daily_drawdown_recovery,
)
from mf_analytics.quality import Reason
from mf_analytics.universe import DEFAULT_UNIVERSE

AS_OF = pd.Timestamp("2026-06-30")
COHORT_START = "2006-07-31"


def series(start: str, months: int, monthly_rate: float = 0.01) -> SchemeSeries:
    index = pd.DatetimeIndex(pd.date_range(start, periods=months, freq="ME"), name="date")
    nav = 100.0 * (1.0 + monthly_rate) ** np.arange(months)
    monthly = pd.DataFrame({"nav": nav, "obs_date": index}, index=index)
    return SchemeSeries(monthly=monthly, returns=monthly_returns(monthly)["monthly_return"])


def master_frame(codes: list[str]) -> pd.DataFrame:
    return pd.DataFrame(
        [
            {
                "scheme_code": code,
                "clean_sub_category": "Mid Cap Fund",
                "clean_category": "Equity Scheme",
                "peer_group": peer_group(
                    "Equity Scheme", "Mid Cap Fund", f"{code} Fund", "Mid Cap"
                ),
                "clean_plan": "Direct",
                "clean_option": "Growth",
                "is_active": True,
            }
            for code in codes
        ]
    )


def flags_for(code: str, scheme: SchemeSeries, zero_nav_excluded: bool = False) -> list[str]:
    """Run one scheme through the snapshot builder inside a long-established cohort."""
    peers = {f"P{i}": series(COHORT_START, 240, 0.009 + i / 1000) for i in range(6)}
    all_series = {**peers, code: scheme}
    settings = Settings()
    contexts = build_category_contexts(
        master_frame(list(all_series)), all_series, DEFAULT_UNIVERSE, AS_OF, settings
    )
    context = next(ctx for ctx in contexts.values() if code in ctx.members)
    row, _ = compute_scheme_row(
        code,
        scheme,
        {
            "clean_sub_category": "Mid Cap Fund",
            "clean_plan": "Direct",
            "clean_option": "Growth",
            "is_active": True,
        },
        context,
        None,
        None,
        None,
        None,
        {},
        {},
        zero_nav_excluded,
        settings,
        DEFAULT_UNIVERSE,
        AS_OF,
    )
    return json.loads(row["data_quality_flags"])


@pytest.mark.parametrize(
    ("months", "expected"),
    [
        (240, set()),
        (100, {"insufficient_history_10y"}),
        (40, {"insufficient_history_5y", "insufficient_history_10y"}),
        (20, {"insufficient_history_3y", "insufficient_history_5y", "insufficient_history_10y"}),
    ],
)
def test_history_is_flagged_for_every_horizon_it_cannot_support(
    months: int, expected: set[str]
) -> None:
    flags = flags_for("X", series(COHORT_START, months))

    assert {f for f in flags if f.startswith("insufficient_history_")} == expected


def test_a_scheme_whose_zero_navs_were_dropped_says_so() -> None:
    scheme = series(COHORT_START, 240)

    assert "terminal_zero_nav_excluded" in flags_for("X", scheme, zero_nav_excluded=True)
    assert "terminal_zero_nav_excluded" not in flags_for("X", scheme)


def test_a_young_scheme_among_long_lived_peers_is_flagged_as_a_possible_reissued_code() -> None:
    assert "possible_merger_or_rebrand" in flags_for("X", series("2024-07-31", 24))


def test_a_scheme_as_old_as_its_peers_is_not_flagged_as_a_reissued_code() -> None:
    assert "possible_merger_or_rebrand" not in flags_for("X", series(COHORT_START, 240))


def test_a_genuinely_short_history_alone_is_not_enough_to_suspect_a_reissued_code() -> None:
    """The cohort has to be the older one; a young peer group is just a young category."""
    young = {f"P{i}": series("2024-07-31", 24, 0.009 + i / 1000) for i in range(6)}
    all_series = {**young, "X": series("2024-07-31", 24)}
    settings = Settings()
    contexts = build_category_contexts(
        master_frame(list(all_series)), all_series, DEFAULT_UNIVERSE, AS_OF, settings
    )
    context = next(ctx for ctx in contexts.values() if "X" in ctx.members)
    row, _ = compute_scheme_row(
        "X",
        all_series["X"],
        {},
        context,
        None,
        None,
        None,
        None,
        {},
        {},
        False,
        settings,
        DEFAULT_UNIVERSE,
        AS_OF,
    )

    assert "possible_merger_or_rebrand" not in json.loads(row["data_quality_flags"])


def test_the_rolling_series_handed_back_is_the_one_the_summary_counted() -> None:
    scheme = series(COHORT_START, 240)
    peers = {f"P{i}": series(COHORT_START, 240, 0.009 + i / 1000) for i in range(6)}
    all_series = {**peers, "X": scheme}
    settings = Settings()
    contexts = build_category_contexts(
        master_frame(list(all_series)), all_series, DEFAULT_UNIVERSE, AS_OF, settings
    )
    row, rolling = compute_scheme_row(
        "X",
        scheme,
        {},
        next(iter(contexts.values())),
        None,
        None,
        None,
        None,
        {},
        {},
        False,
        settings,
        DEFAULT_UNIVERSE,
        AS_OF,
    )

    assert set(rolling) == set(ROLLING_HORIZONS)
    for h in ROLLING_HORIZONS:
        assert int(rolling[h].notna().sum()) == row[f"rolling_{h}y_window_count"]


def _window_series(values: pd.Series, as_of: pd.Timestamp, years: int) -> pd.Series:
    start = as_of - pd.DateOffset(years=years)
    return values[(values.index > start) & (values.index <= as_of)].dropna()


def test_capture_columns_reuse_the_same_leave_one_out_peer_series_as_information_ratio() -> None:
    """No second peer definition: capture must not quietly diverge from IR vs sub-category."""
    scheme = series(COHORT_START, 240, monthly_rate=0.011)
    peers = {f"P{i}": series(COHORT_START, 240, 0.009 + i / 1000) for i in range(6)}
    all_series = {**peers, "X": scheme}
    settings = Settings()
    contexts = build_category_contexts(
        master_frame(list(all_series)), all_series, DEFAULT_UNIVERSE, AS_OF, settings
    )
    context = next(iter(contexts.values()))
    row, _ = compute_scheme_row(
        "X",
        scheme,
        {},
        context,
        None,
        None,
        None,
        None,
        {},
        {},
        False,
        settings,
        DEFAULT_UNIVERSE,
        AS_OF,
    )

    for h in CAPTURE_HORIZONS:
        fund_r = _window_series(scheme.returns, AS_OF, h)
        peer_r = _window_series(context.ex_self_returns("X"), AS_OF, h)
        expected = risk.capture_ratios(fund_r, peer_r, MIN_RISK_OBS[h])
        assert row[f"upside_capture_{h}y"] == pytest.approx(expected.up.value)
        assert row[f"downside_capture_{h}y"] == pytest.approx(expected.down.value)


def test_capture_is_null_with_insufficient_peers_when_the_fund_has_no_category() -> None:
    scheme = series(COHORT_START, 240)
    row, _ = compute_scheme_row(
        "X",
        scheme,
        {},
        None,
        None,
        None,
        None,
        None,
        {},
        {},
        False,
        Settings(),
        DEFAULT_UNIVERSE,
        AS_OF,
    )

    reasons = json.loads(row["missing_reasons"])
    for h in CAPTURE_HORIZONS:
        assert row[f"upside_capture_{h}y"] is None
        assert row[f"downside_capture_{h}y"] is None
        assert reasons[f"upside_capture_{h}y"] == Reason.INSUFFICIENT_PEERS
        assert reasons[f"downside_capture_{h}y"] == Reason.INSUFFICIENT_PEERS


def _returns_for_years(rates_by_year: dict[int, float], first_month: int = 1) -> pd.Series:
    """One monthly return series compounding to exactly `rates_by_year` each full year."""
    parts = []
    for year, annual in sorted(rates_by_year.items()):
        monthly_rate = (1.0 + annual) ** (1 / 12) - 1
        idx = pd.date_range(f"{year}-{first_month:02d}-01", periods=12, freq="ME")
        parts.append(pd.Series(monthly_rate, index=idx))
    return pd.concat(parts)


def test_worst_calendar_year_and_positive_share_ignore_partial_years() -> None:
    rates = {2018: 0.20, 2019: -0.30, 2020: 0.15, 2021: 0.05}
    full_years = _returns_for_years(rates)
    # A 3-month partial year appended after the last full one, at a return that would
    # otherwise "win" worst-year if it were wrongly treated as comparable.
    partial = pd.Series([-0.5, -0.5, -0.5], index=pd.date_range("2022-01-31", periods=3, freq="ME"))
    scheme = series(COHORT_START, 240)
    scheme.returns = pd.concat([full_years, partial])

    row, _ = compute_scheme_row(
        "X",
        scheme,
        {},
        None,
        None,
        None,
        None,
        None,
        {},
        {},
        False,
        Settings(),
        DEFAULT_UNIVERSE,
        AS_OF,
    )

    assert row["worst_calendar_year"] == 2019
    assert row["worst_calendar_year_return"] == pytest.approx(-0.30)
    assert row["positive_calendar_years_pct"] == pytest.approx(3 / 4)


def test_momentum_skips_the_most_recent_month() -> None:
    """12-1, not 12-0: the last month must not reach the number at all."""
    scheme = series(COHORT_START, 240)
    months = pd.date_range("2025-07-31", periods=12, freq="ME")  # the year ending AS_OF
    # 1% a month for eleven months, then a crash in the month that must be excluded.
    scheme.returns = pd.Series([0.01] * 11 + [-0.50], index=months)

    row, _ = compute_scheme_row(
        "X",
        scheme,
        {},
        None,
        None,
        None,
        None,
        None,
        {},
        {},
        False,
        Settings(),
        DEFAULT_UNIVERSE,
        AS_OF,
    )

    assert row["momentum_12_1"] == pytest.approx(1.01**11 - 1.0)
    assert "momentum_12_1" not in json.loads(row["missing_reasons"])


def test_momentum_is_null_below_a_full_eleven_months() -> None:
    scheme = series(COHORT_START, 240)
    scheme.returns = pd.Series([0.01] * 6, index=pd.date_range("2025-12-31", periods=6, freq="ME"))

    row, _ = compute_scheme_row(
        "X",
        scheme,
        {},
        None,
        None,
        None,
        None,
        None,
        {},
        {},
        False,
        Settings(),
        DEFAULT_UNIVERSE,
        AS_OF,
    )

    assert row["momentum_12_1"] is None
    assert json.loads(row["missing_reasons"])["momentum_12_1"] == Reason.INSUFFICIENT_HISTORY


def test_worst_calendar_year_is_null_below_the_minimum_complete_years() -> None:
    scheme = series(COHORT_START, 240)
    scheme.returns = _returns_for_years({2020: 0.10, 2021: -0.10})
    assert MIN_CALENDAR_YEARS > 2

    row, _ = compute_scheme_row(
        "X",
        scheme,
        {},
        None,
        None,
        None,
        None,
        None,
        {},
        {},
        False,
        Settings(),
        DEFAULT_UNIVERSE,
        AS_OF,
    )

    reasons = json.loads(row["missing_reasons"])
    assert row["worst_calendar_year_return"] is None
    assert row["worst_calendar_year"] is None
    assert row["positive_calendar_years_pct"] is None
    assert reasons["worst_calendar_year_return"] == Reason.INSUFFICIENT_HISTORY
    assert reasons["worst_calendar_year"] == Reason.INSUFFICIENT_HISTORY


def test_calendar_year_summary_calls_calendar_year_returns_not_a_reimplementation() -> None:
    """A ground truth built straight from the shared function `/behaviour` also calls."""
    scheme = series(COHORT_START, 240)
    scheme.returns = _returns_for_years({2018: 0.20, 2019: -0.30, 2020: 0.15, 2021: 0.05})
    expected = calendar_year_returns(scheme.returns)
    expected_complete = expected[expected["months"] == 12]

    row, _ = compute_scheme_row(
        "X",
        scheme,
        {},
        None,
        None,
        None,
        None,
        None,
        {},
        {},
        False,
        Settings(),
        DEFAULT_UNIVERSE,
        AS_OF,
    )

    worst = expected_complete.loc[expected_complete["fund_return"].idxmin()]
    assert row["worst_calendar_year"] == int(worst["year"])
    assert row["worst_calendar_year_return"] == pytest.approx(float(worst["fund_return"]))


def test_drawdown_recovery_date_is_the_first_day_nav_regains_its_pre_fall_peak(tmp_path) -> None:
    from mf_analytics.db import connect, init_schema

    dates = pd.bdate_range("2022-01-03", "2026-08-31")
    # Climbs to a peak, falls, and climbs back through it partway through the window.
    nav = np.concatenate(
        [
            np.linspace(100, 150, 400),
            np.linspace(150, 90, 200)[1:],
            np.linspace(90, 200, len(dates) - 599),
        ]
    )
    frame = pd.DataFrame({"scheme_code": "A", "date": dates.date, "nav": nav})
    settings = Settings(mf_data_dir=tmp_path / "d", mf_duckdb_path=tmp_path / "d" / "t.duckdb")
    settings.ensure_dirs()
    scheme = SchemeSeries(monthly=pd.DataFrame(), returns=pd.Series(dtype=float))
    with connect(settings) as con:
        init_schema(con)
        con.register("n", frame)
        con.execute("CREATE OR REPLACE TABLE nav_daily AS SELECT * FROM n")
        con.unregister("n")
        out = daily_drawdown_recovery(con, {"A": scheme}, pd.Timestamp("2026-08-31"))

    assert out["A"] is not None
    trough_date = pd.Timestamp(dates[599])
    assert out["A"] > trough_date


def test_drawdown_recovery_is_none_when_the_fund_never_regained_its_peak(tmp_path) -> None:
    from mf_analytics.db import connect, init_schema

    dates = pd.bdate_range("2022-01-03", "2026-08-31")
    nav = np.concatenate([np.linspace(100, 150, 400), np.linspace(150, 90, len(dates) - 400)])
    frame = pd.DataFrame({"scheme_code": "A", "date": dates.date, "nav": nav})
    settings = Settings(mf_data_dir=tmp_path / "d", mf_duckdb_path=tmp_path / "d" / "t.duckdb")
    settings.ensure_dirs()
    scheme = SchemeSeries(monthly=pd.DataFrame(), returns=pd.Series(dtype=float))
    with connect(settings) as con:
        init_schema(con)
        con.register("n", frame)
        con.execute("CREATE OR REPLACE TABLE nav_daily AS SELECT * FROM n")
        con.unregister("n")
        out = daily_drawdown_recovery(con, {"A": scheme}, pd.Timestamp("2026-08-31"))

    assert out["A"] is None


def test_recovery_days_in_the_row_is_null_with_not_recovered_never_a_number() -> None:
    """The row-level wiring: an unrecovered 5y drawdown must not surface a fake day count."""
    scheme = series(COHORT_START, 240)
    dd = risk.Drawdown(
        risk.Metric(-0.30, 60),
        peak_date=pd.Timestamp("2023-01-31"),
        trough_date=pd.Timestamp("2023-06-30"),
    )
    row, _ = compute_scheme_row(
        "X",
        scheme,
        {},
        None,
        None,
        None,
        None,
        None,
        {5: dd},
        {"X": None},
        False,
        Settings(),
        DEFAULT_UNIVERSE,
        AS_OF,
    )

    reasons = json.loads(row["missing_reasons"])
    assert row["max_drawdown_5y_recovery_days"] is None
    assert reasons["max_drawdown_5y_recovery_days"] == NOT_RECOVERED


def test_recovery_days_in_the_row_is_the_gap_between_trough_and_recovery() -> None:
    scheme = series(COHORT_START, 240)
    dd = risk.Drawdown(
        risk.Metric(-0.30, 60),
        peak_date=pd.Timestamp("2023-01-31"),
        trough_date=pd.Timestamp("2023-06-30"),
    )
    recovered = pd.Timestamp("2024-02-29")
    row, _ = compute_scheme_row(
        "X",
        scheme,
        {},
        None,
        None,
        None,
        None,
        None,
        {5: dd},
        {"X": recovered},
        False,
        Settings(),
        DEFAULT_UNIVERSE,
        AS_OF,
    )

    assert row["max_drawdown_5y_recovery_days"] == (recovered - dd.trough_date).days


# ------------------------------------------------------- columns that reach the snapshot
# Both of these are null for every row of the standard fixture, for legitimate reasons:
# no style basis is registered, and the master is ingested once so there is one AUM
# quarter. That made them indistinguishable from a regression that nulls them for good.


def _row_with_style_basis(fund: SchemeSeries, basis: pd.DataFrame) -> dict[str, object]:
    peers = {f"P{i}": series(COHORT_START, 240, 0.009 + i / 1000) for i in range(6)}
    all_series = {**peers, "F1": fund}
    settings = Settings()
    contexts = build_category_contexts(
        master_frame(list(all_series)), all_series, DEFAULT_UNIVERSE, AS_OF, settings
    )
    row, _ = compute_scheme_row(
        "F1",
        fund,
        {
            "clean_sub_category": "Mid Cap Fund",
            "clean_plan": "Direct",
            "clean_option": "Growth",
            "is_active": True,
        },
        next(ctx for ctx in contexts.values() if "F1" in ctx.members),
        None,
        None,
        None,
        None,
        {},
        {},
        False,
        settings,
        DEFAULT_UNIVERSE,
        AS_OF,
        style_factors=basis,
    )
    return row


def test_style_drift_reaches_the_snapshot_as_a_number_when_a_basis_exists() -> None:
    index = pd.DatetimeIndex(pd.date_range(COHORT_START, periods=240, freq="ME"), name="date")
    rng = np.random.default_rng(20260909)
    a = pd.Series(rng.normal(0.010, 0.04, len(index)), index=index)
    b = pd.Series(rng.normal(0.006, 0.03, len(index)), index=index)
    basis = pd.DataFrame({"A": a, "B": b})
    # The switch has to fall INSIDE the 3-year drift window to show up in it. Putting it
    # at the midpoint of a 20-year series leaves the last 3 years purely basis B, which
    # correctly reads as zero drift and made an earlier version of this test vacuous.
    switch = len(index) - 18
    blended = pd.concat([a.iloc[:switch], b.iloc[switch:]])

    row = _row_with_style_basis(
        SchemeSeries(
            monthly=pd.DataFrame({"nav": 100.0, "obs_date": index}, index=index),
            returns=blended,
        ),
        basis,
    )

    drift = row["style_drift_3y"]
    assert drift is not None, "a fund fitted against a live basis must get a drift number"
    assert 0.0 < float(drift) <= 1.0, "a style change inside the window must move the number"
    assert "style_drift_3y" not in json.loads(row["missing_reasons"])


def test_style_drift_is_named_missing_rather_than_zero_without_a_basis() -> None:
    """Zero drift and no basis to measure drift against are different facts."""
    index = pd.DatetimeIndex(pd.date_range(COHORT_START, periods=240, freq="ME"), name="date")
    fund = series(COHORT_START, 240)

    row = _row_with_style_basis(fund, pd.DataFrame(index=index))

    assert row["style_drift_3y"] is None
    assert json.loads(row["missing_reasons"])["style_drift_3y"] == Reason.BENCHMARK_UNAVAILABLE
