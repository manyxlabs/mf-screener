"""Plan/option/category normalisation and universe filtering."""

from __future__ import annotations

from datetime import datetime
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

from mf_analytics import scoring
from mf_analytics.classify import (
    OPT_BONUS,
    OPT_GROWTH,
    OPT_IDCW_PAYOUT,
    OPT_IDCW_REINVEST,
    OPT_OTHER,
    PLAN_DIRECT,
    PLAN_REGULAR,
    PLAN_UNKNOWN,
    cap_band,
    classify_frame,
    clean_option,
    clean_plan,
    clean_sub_category,
    derive_fund_family_ids,
    fund_family_key,
    normalise_fund_name,
    style,
)
from mf_analytics.config import Settings
from mf_analytics.db import connect, init_schema
from mf_analytics.ingest.master import (
    CANONICAL_COLUMNS,
    load_master,
    record_aum_history,
    record_category_history,
    record_scheme_aliases,
)
from mf_analytics.metrics.series import monthly_returns
from mf_analytics.pipeline import (
    SchemeSeries,
    build_category_contexts,
    compute_aum_family_latest,
    compute_aum_growth,
    compute_aum_percentile_in_sub_category,
    resolve_categories_as_of,
)
from mf_analytics.universe import PeerUniverse


@pytest.mark.parametrize(
    ("source", "name", "expected"),
    [
        ("Direct", "HDFC Mid Cap Fund - Direct - Growth", PLAN_DIRECT),
        ("Regular", "HDFC Mid Cap Fund - Regular - Growth", PLAN_REGULAR),
        ("Other", "Franklin India Index Fund - Direct - Growth", PLAN_DIRECT),
        ("Other", "Franklin India Prima Fund-Growth", PLAN_UNKNOWN),
        (None, "Some Fund - Regular Plan", PLAN_REGULAR),
    ],
)
def test_clean_plan(source, name, expected):
    assert clean_plan(source, name) == expected


@pytest.mark.parametrize(
    ("source", "name", "expected"),
    [
        ("Growth", "Fund - Direct - Growth", OPT_GROWTH),
        ("IDCW", "Fund - Direct - IDCW Payout", OPT_IDCW_PAYOUT),
        ("IDCW", "Fund - Direct - IDCW Reinvestment", OPT_IDCW_REINVEST),
        ("IDCW", "Fund - Direct - Dividend", OPT_IDCW_PAYOUT),
        ("Other", "Fund - Segregated Portfolio", OPT_OTHER),
    ],
)
def test_clean_option(source, name, expected):
    assert clean_option(source, name) == expected


def test_clean_sub_category_falls_back_to_raw_category():
    assert clean_sub_category(None, "Income") == "Income"
    assert clean_sub_category("Mid Cap Fund", "Equity") == "Mid Cap Fund"
    assert clean_sub_category(None, None) == "Unclassified"


@pytest.fixture
def master() -> pd.DataFrame:
    rows = [
        ("1", "A Fund - Direct - Growth", "Direct", "Growth", "Mid Cap Fund", True),
        ("2", "B Fund - Regular - Growth", "Regular", "Growth", "Mid Cap Fund", True),
        ("3", "C Fund - Direct - IDCW", "Direct", "IDCW", "Mid Cap Fund", True),
        ("4", "D Fund - Direct - Growth", "Direct", "Growth", "Mid Cap Fund", False),
        ("5", "E Fund - Direct - Growth", "Direct", "Growth", "Small Cap Fund", True),
    ]
    frame = pd.DataFrame(
        rows,
        columns=[
            "scheme_code",
            "scheme_name",
            "scheme_plan",
            "scheme_option",
            "category_sub",
            "is_active",
        ],
    )
    frame["category"] = "Equity"
    frame["category_group_clean"] = "Equity Scheme"
    return classify_frame(frame)


def test_default_universe_is_active_direct_growth_only(master):
    filtered = PeerUniverse().filter(master)
    assert filtered["scheme_code"].tolist() == ["1", "5"]


def test_universe_can_include_regular_plans(master):
    filtered = PeerUniverse(plan_scope="direct_regular").filter(master)
    assert filtered["scheme_code"].tolist() == ["1", "2", "5"]


def test_universe_can_include_all_options(master):
    filtered = PeerUniverse(option_scope="all").filter(master)
    assert filtered["scheme_code"].tolist() == ["1", "3", "5"]


def test_universe_can_include_inactive_schemes(master):
    filtered = PeerUniverse(active_only=False).filter(master)
    assert filtered["scheme_code"].tolist() == ["1", "4", "5"]


def test_category_key_encodes_the_methodology():
    key = PeerUniverse().category_key("Mid Cap Fund")
    assert key == "sub_category=Mid Cap Fund|plan=direct|option=growth|active=y|agg=mean"
    assert PeerUniverse(aggregation="median").category_key("Mid Cap Fund") != key


def test_a_bonus_option_filed_under_a_growth_plan_stays_bonus() -> None:
    """AMFI's own field is the classification; the name cannot overrule it.

    These are filed as "... Growth Plan - Bonus Option", so reading the name first
    put bonus schemes into the Growth peer universe alongside their own fund's
    growth twin, double-counting it in every category average.
    """
    name = "Nippon India Power & Infra Fund - Direct Plan Growth Plan - Bonus Option"

    assert clean_option("Bonus", name) == OPT_BONUS


def test_an_unclassified_option_still_reads_the_name() -> None:
    """`Other` means AMFI did not say, which is the one case the name may decide."""
    assert clean_option("Other", "Some Fund - Direct Plan - Growth Option") == OPT_GROWTH
    assert clean_option("Other", "Some Fund - Direct Plan - IDCW") == OPT_IDCW_PAYOUT


# Every case here is a real scheme name from the AMFI master, because the traps that
# matter are the ones the actual naming conventions set.
@pytest.mark.parametrize(
    ("sub_category", "scheme_name", "expected"),
    [
        # SEBI's own sub-category names carry the band, and they win over the scheme name.
        ("Mid Cap Fund", "Taurus Mid Cap Fund - Direct Plan - Growth", "Mid Cap"),
        ("Flexi Cap Fund", "Taurus Flexi Cap Fund - Direct Plan - Growth", "Flexi Cap"),
        # Passive sub-categories carry none, so the index in the name decides.
        ("Index Funds", "Tata Nifty Midcap 150 Momentum 50 Index Fund", "Mid Cap"),
        ("Index Funds", "Nippon India Nifty Smallcap 250 Index Fund", "Small Cap"),
        ("Index Funds", "Motilal Oswal Nifty 500 Momentum 50 Index Fund", "Broad Market"),
        ("Index Funds", "UTI Nifty 200 Momentum 30 Index Fund", "Large & Mid Cap"),
        # "LargeMidcap" is one word, and "midcap" must not claim it first.
        ("Index Funds", "Zerodha Nifty LargeMidcap 250 Index Fund", "Large & Mid Cap"),
        ("Index Funds", "Edelweiss NIFTY Large Midcap 250 Index Fund", "Large & Mid Cap"),
        # Nifty Next 50 is ranks 51-100, which SEBI counts as large cap, not mid.
        ("Index Funds", "Kotak Nifty Next 50 Index Fund - Direct Plan", "Large Cap"),
        ("Index Funds", "UTI Nifty Midsmallcap 400 Momentum Quality 100", "Mid & Small Cap"),
        # A renamed scheme carries the old mandate in brackets; it must not be read.
        ("Focused Fund", "Sundaram Focused Fund (Formerly Principal Focused Multicap)", None),
        # A thematic fund declares no band at all.
        ("Sectoral/Thematic", "quant Momentum Fund - Growth Option - Direct Plan", None),
        ("Debt Scheme", "Quantum Liquid Fund - Direct Plan Growth Option", None),
    ],
)
def test_cap_band(sub_category: str, scheme_name: str, expected: str | None) -> None:
    assert cap_band(sub_category, scheme_name) == expected


@pytest.mark.parametrize(
    ("category", "sub_category", "scheme_name", "expected"),
    [
        ("Other Scheme", "Index Funds", "Kotak Nifty500 Momentum 50 Index Fund", "Momentum"),
        # A "Momentum Quality" index selects on momentum first, so momentum leads.
        (
            "Other Scheme",
            "Index Funds",
            "Groww Nifty Smallcap 250 Momentum Quality 100 Index Fund",
            "Momentum",
        ),
        ("Equity Scheme", "Value Fund", "Quantum Value Fund - Direct Plan Growth", "Value"),
        # Contra is a value mandate under another name.
        ("Equity Scheme", "Contra Fund", "SBI Contra Fund - Direct Plan - Growth", "Value"),
        ("Other Scheme", "Index Funds", "Axis Nifty500 Quality 50 Index Fund", "Quality"),
        (
            "Other Scheme",
            "Index Funds",
            "Nippon India Nifty 500 Low Volatility 50 Index Fund",
            "Low Volatility",
        ),
        # An equity scheme that declares no tilt is a blend, not an unknown.
        ("Equity Scheme", "Flexi Cap Fund", "Parag Parikh Flexi Cap Fund - Direct", "Blend"),
        # Style is an equity idea. A debt or gold scheme must not be given one.
        ("Debt Scheme", "Liquid Fund", "Quantum Liquid Fund - Direct Plan Growth", None),
        ("Other Scheme", "Gold ETF", "SBI GOLD FUND- DIRECT PLAN - GROWTH", None),
    ],
)
def test_style(category: str, sub_category: str, scheme_name: str, expected: str | None) -> None:
    assert style(category, sub_category, scheme_name) == expected


# --- T2.2: category history --------------------------------------------------------


def _t22_master_row(code: str, sub_category: str, ingested_at: datetime) -> dict:
    return {
        "scheme_code": code,
        "scheme_name": f"{code} Fund - Direct - Growth",
        "amc": "Test AMC",
        "scheme_type": "Open Ended Schemes",
        "category": "Equity",
        "sub_category": sub_category,
        "clean_category": "Equity Scheme",
        "clean_sub_category": sub_category,
        "cap_band": None,
        "style": None,
        "plan": "Direct",
        "option": "Growth",
        "clean_plan": PLAN_DIRECT,
        "clean_option": OPT_GROWTH,
        "fund_family_id": f"fam:{code}",
        "isin_growth": None,
        "isin_dividend": None,
        "launch_date": pd.Timestamp("2010-01-31").date(),
        "first_nav_date": pd.Timestamp("2010-01-31").date(),
        "last_nav_date": pd.Timestamp("2026-06-30").date(),
        "latest_nav": 100.0,
        "latest_nav_date": pd.Timestamp("2026-06-30").date(),
        "latest_aum": 1000.0,
        "aum_date": pd.Timestamp("2026-06-30").date(),
        "aum_quarter": "June-2026",
        "is_active": True,
        "is_stale": False,
        "fund_age_years": 16.0,
        "source": "test",
        "ingested_at": ingested_at,
    }


def _t22_master_frame(rows: list[dict]) -> pd.DataFrame:
    frame = pd.DataFrame(rows).loc[:, CANONICAL_COLUMNS]
    frame["is_active"] = frame["is_active"].astype("boolean")
    frame["is_stale"] = frame["is_stale"].astype("boolean")
    return frame


def _t22_series(months: int = 6, rate: float = 0.01) -> SchemeSeries:
    index = pd.DatetimeIndex(pd.date_range("2025-01-31", periods=months, freq="ME"), name="date")
    nav = 100.0 * (1.0 + rate) ** np.arange(months)
    monthly = pd.DataFrame({"nav": nav, "obs_date": index}, index=index)
    return SchemeSeries(monthly=monthly, returns=monthly_returns(monthly)["monthly_return"])


@pytest.fixture
def category_history_settings(tmp_path: Path) -> Settings:
    settings = Settings(
        mf_data_dir=tmp_path / "data",
        mf_duckdb_path=tmp_path / "data" / "processed" / "s.duckdb",
    )
    settings.ensure_dirs()
    return settings


def test_master_ingest_diff_produces_two_category_history_rows(
    category_history_settings: Settings,
) -> None:
    s = category_history_settings
    t0 = datetime(2026, 1, 15)
    t1 = datetime(2026, 4, 15)
    load_master(_t22_master_frame([_t22_master_row("X1", "Mid Cap Fund", t0)]), s)

    new = _t22_master_frame([_t22_master_row("X1", "Small Cap Fund", t1)])
    changed = record_category_history(new, s, "RUN2", t1)
    assert changed == 1
    load_master(new, s)

    # A scheme whose category never moves must accrue no history at all.
    unchanged = record_category_history(new, s, "RUN3", t1)
    assert unchanged == 0

    with connect(s) as con:
        rows = con.execute(
            "SELECT clean_sub_category, valid_from, valid_to, observed_run_id "
            "FROM scheme_category_history WHERE scheme_code = 'X1' ORDER BY valid_from"
        ).fetchall()
    assert len(rows) == 2
    assert rows[0] == ("Mid Cap Fund", t0.date(), t1.date(), "RUN2")
    assert rows[1] == ("Small Cap Fund", t1.date(), None, "RUN2")


def test_peer_grouping_resolves_category_as_of_window_end(
    category_history_settings: Settings,
) -> None:
    """A scheme reclassified mid-series must land in its old peer group for a window
    ending before the change and in its new one for a window ending after it - not
    always in whatever scheme_master currently says."""
    s = category_history_settings
    t0 = datetime(2026, 1, 15)
    t1 = datetime(2026, 4, 15)
    load_master(
        _t22_master_frame(
            [
                _t22_master_row("X1", "Mid Cap Fund", t0),
                _t22_master_row("P1", "Mid Cap Fund", t0),
                _t22_master_row("P2", "Small Cap Fund", t0),
            ]
        ),
        s,
    )
    new = _t22_master_frame(
        [
            _t22_master_row("X1", "Small Cap Fund", t1),
            _t22_master_row("P1", "Mid Cap Fund", t1),
            _t22_master_row("P2", "Small Cap Fund", t1),
        ]
    )
    record_category_history(new, s, "RUN2", t1)
    load_master(new, s)

    series = {code: _t22_series() for code in ("X1", "P1", "P2")}
    universe = PeerUniverse(min_peers=2)

    with connect(s) as con:
        master = con.execute("SELECT * FROM scheme_master").fetch_df()
        master["scheme_code"] = master["scheme_code"].astype(str)

        as_of_before = pd.Timestamp("2026-02-15")
        before, resolution_before = resolve_categories_as_of(con, master, as_of_before)
        assert resolution_before["X1"] == "history"
        contexts_before = build_category_contexts(before, series, universe, as_of_before, s)
        members_before = next(c.members for c in contexts_before.values() if "X1" in c.members)
        assert set(members_before) == {"X1", "P1"}

        as_of_after = pd.Timestamp("2026-05-15")
        after, resolution_after = resolve_categories_as_of(con, master, as_of_after)
        assert resolution_after["X1"] == "history"
        contexts_after = build_category_contexts(after, series, universe, as_of_after, s)
        members_after = next(c.members for c in contexts_after.values() if "X1" in c.members)
        assert set(members_after) == {"X1", "P2"}

        # A scheme that never changed always falls back to the current master value.
        assert resolution_before["P1"] == "current"
        assert resolution_after["P2"] == "current"


# --- T2.1 fund family identity ----------------------------------------------------


def test_normalise_fund_name_strips_plan_and_option_words() -> None:
    direct = normalise_fund_name("HDFC Mid Cap Fund - Direct Plan - Growth Option")
    regular = normalise_fund_name("HDFC Mid Cap Fund - Regular Plan - Growth Option")
    idcw = normalise_fund_name("HDFC Mid Cap Fund - Direct Plan - IDCW Reinvestment")
    assert direct == regular == idcw


def test_normalise_fund_name_drops_a_formerly_known_as_parenthetical() -> None:
    name = "Sundaram Focused Fund (Formerly Principal Focused Multicap Fund) - Direct - Growth"
    assert "principal" not in normalise_fund_name(name)


def test_fund_family_key_needs_a_distinctive_name() -> None:
    # "ELSS" alone, after the plan/option words are gone, is too generic to trust.
    assert fund_family_key("Quantum", "ELSS Fund - Direct Plan - Growth") is None
    assert fund_family_key("HDFC", "HDFC Mid Cap Fund - Direct Plan - Growth") is not None


@pytest.fixture
def family_fixture() -> pd.DataFrame:
    """One fixture AMC with a Direct/Regular Growth pair, an IDCW twin tied by ISIN,
    an unrelated fund from the same AMC, and an unusually named fund with no ISIN
    that must not be swept into any other family.
    """
    rows = [
        # Direct Growth and Regular Growth of "HDFC Mid Cap Fund": same name once
        # plan/option words are stripped, different ISINs (as plan variants really are).
        ("101", "HDFC Mid Cap Fund - Direct Plan - Growth", "HDFC", "INF001", ""),
        ("102", "HDFC Mid Cap Fund - Regular Plan - Growth", "HDFC", "INF002", ""),
        # The Direct IDCW option of the same fund, tied to the Direct Growth row by a
        # shared ISIN rather than by name (its own name-derived key also matches here,
        # so this doubles as the ISIN-tie and name-tie agreeing).
        ("103", "HDFC Mid Cap Fund - Direct Plan - IDCW Payout", "HDFC", "INF001", "INF003"),
        # A different fund entirely, same AMC.
        ("104", "HDFC Small Cap Fund - Direct Plan - Growth", "HDFC", "INF010", ""),
        # No ISIN, and a name that only resembles another fund's - must stay ungrouped.
        ("105", "HDFC Unusual Sector Opportunities Fund - Direct - Growth", "HDFC", "", ""),
        ("106", "HDFC Unusual Sector Opportunity Fund - Direct - Growth", "HDFC", "", ""),
    ]
    return pd.DataFrame(
        rows, columns=["scheme_code", "scheme_name", "amc", "isin_growth", "isin_dividend"]
    )


def test_direct_and_regular_growth_share_a_family(family_fixture: pd.DataFrame) -> None:
    family_id = derive_fund_family_ids(family_fixture)
    by_code = dict(zip(family_fixture["scheme_code"], family_id, strict=True))
    assert by_code["101"] == by_code["102"] == by_code["103"]


def test_a_different_fund_at_the_same_amc_is_not_swept_in(family_fixture: pd.DataFrame) -> None:
    family_id = derive_fund_family_ids(family_fixture)
    by_code = dict(zip(family_fixture["scheme_code"], family_id, strict=True))
    assert by_code["104"] != by_code["101"]


def test_an_unusual_name_with_no_isin_is_left_ungrouped(family_fixture: pd.DataFrame) -> None:
    """Two funds resembling each other's name, neither with an ISIN, must not merge:
    an exact match is required, and a near-miss is exactly the guess that must not
    be made silently.
    """
    family_id = derive_fund_family_ids(family_fixture)
    by_code = dict(zip(family_fixture["scheme_code"], family_id, strict=True))
    assert by_code["105"] != by_code["106"]
    assert by_code["105"] not in (by_code["101"], by_code["102"], by_code["103"], by_code["104"])


def test_classify_frame_adds_fund_family_id(family_fixture: pd.DataFrame) -> None:
    frame = family_fixture.copy()
    frame["scheme_plan"] = "Direct"
    frame["scheme_option"] = "Growth"
    frame["category_sub"] = "Mid Cap Fund"
    frame["category"] = "Equity"
    frame["category_group_clean"] = "Equity Scheme"
    out = classify_frame(frame)
    assert "fund_family_id" in out.columns
    by_code = dict(zip(out["scheme_code"], out["fund_family_id"], strict=True))
    assert by_code["101"] == by_code["102"]


def _t21_master_row(
    code: str, name: str, amc: str, isin_growth: str | None, ingested_at: datetime
) -> dict:
    row = _t22_master_row(code, "Mid Cap Fund", ingested_at)
    row["scheme_name"] = name
    row["amc"] = amc
    row["isin_growth"] = isin_growth
    row["fund_family_id"] = f"fam:{code}"
    return row


def test_scheme_alias_maps_a_retired_code_by_shared_isin(
    category_history_settings: Settings,
) -> None:
    s = category_history_settings
    t0 = datetime(2026, 1, 15)
    t1 = datetime(2026, 4, 15)
    load_master(
        _t22_master_frame(
            [_t21_master_row("OLD1", "Fund X - Direct - Growth", "AMC1", "INF999", t0)]
        ),
        s,
    )

    new = _t22_master_frame(
        [_t21_master_row("NEW1", "Fund X - Direct - Growth", "AMC1", "INF999", t1)]
    )
    mapped = record_scheme_aliases(new, s, t1)
    assert mapped == 1
    load_master(new, s)

    with connect(s) as con:
        row = con.execute(
            "SELECT new_scheme_code, evidence FROM scheme_alias WHERE old_scheme_code = 'OLD1'"
        ).fetchone()
    assert row[0] == "NEW1"
    assert row[1].startswith("isin_match")


def test_scheme_alias_maps_a_retired_code_by_unambiguous_name(
    category_history_settings: Settings,
) -> None:
    s = category_history_settings
    t0 = datetime(2026, 1, 15)
    t1 = datetime(2026, 4, 15)
    old_name = "Alpine Frontier Opportunities Fund - Direct - Growth"
    new_name = "Alpine Frontier Opportunities Fund - Regular - Growth"
    load_master(
        _t22_master_frame([_t21_master_row("OLD2", old_name, "AMC2", None, t0)]),
        s,
    )
    new = _t22_master_frame([_t21_master_row("NEW2", new_name, "AMC2", None, t1)])
    mapped = record_scheme_aliases(new, s, t1)
    assert mapped == 1
    load_master(new, s)
    with connect(s) as con:
        row = con.execute(
            "SELECT new_scheme_code, evidence FROM scheme_alias WHERE old_scheme_code = 'OLD2'"
        ).fetchone()
    assert row[0] == "NEW2"
    assert row[1].startswith("name_match")


def test_scheme_alias_leaves_an_ambiguous_retirement_unmapped(
    category_history_settings: Settings,
) -> None:
    """Two equally plausible successors must not be guessed between."""
    s = category_history_settings
    t0 = datetime(2026, 1, 15)
    t1 = datetime(2026, 4, 15)
    load_master(
        _t22_master_frame([_t21_master_row("OLD3", "Fund Z - Direct - Growth", "AMC3", None, t0)]),
        s,
    )
    new = _t22_master_frame(
        [
            _t21_master_row("NEW3A", "Fund Z - Direct - Growth", "AMC3", None, t1),
            _t21_master_row("NEW3B", "Fund Z - Direct - Growth", "AMC3", None, t1),
        ]
    )
    mapped = record_scheme_aliases(new, s, t1)
    assert mapped == 0
    load_master(new, s)
    with connect(s) as con:
        row = con.execute("SELECT 1 FROM scheme_alias WHERE old_scheme_code = 'OLD3'").fetchone()
    assert row is None


# --- T2.3: AUM history -------------------------------------------------------------


def _t23_master_row(code: str, aum_quarter: str, aum_date: str, latest_aum: float) -> dict:
    row = _t22_master_row(code, "Mid Cap Fund", datetime(2026, 1, 15))
    row["aum_quarter"] = aum_quarter
    row["aum_date"] = pd.Timestamp(aum_date).date()
    row["latest_aum"] = latest_aum
    return row


def test_master_ingest_a_quarter_apart_appends_two_history_rows(
    category_history_settings: Settings,
) -> None:
    s = category_history_settings
    q1 = _t22_master_frame([_t23_master_row("X1", "March-2026", "2026-03-31", 1000.0)])
    added_first = record_aum_history(q1, s)
    load_master(q1, s)
    assert added_first == 1

    q2 = _t22_master_frame([_t23_master_row("X1", "June-2026", "2026-06-30", 1100.0)])
    added_second = record_aum_history(q2, s)
    load_master(q2, s)
    assert added_second == 1

    with connect(s) as con:
        rows = con.execute(
            "SELECT aum_quarter, latest_aum FROM scheme_aum_history "
            "WHERE scheme_code = 'X1' ORDER BY aum_date"
        ).fetchall()
        growth = compute_aum_growth(con, lookback_quarters=1)
    assert rows == [("March-2026", 1000.0), ("June-2026", 1100.0)]
    assert growth["X1"] == pytest.approx(0.10)


def test_re_ingesting_the_same_quarter_appends_nothing(
    category_history_settings: Settings,
) -> None:
    s = category_history_settings
    q1 = _t22_master_frame([_t23_master_row("X1", "March-2026", "2026-03-31", 1000.0)])
    record_aum_history(q1, s)
    load_master(q1, s)
    repeated = record_aum_history(q1, s)
    assert repeated == 0
    with connect(s) as con:
        n = con.execute(
            "SELECT count(*) FROM scheme_aum_history WHERE scheme_code = 'X1'"
        ).fetchone()[0]
    assert n == 1


def test_growth_is_withheld_below_the_lookback_floor(
    category_history_settings: Settings,
) -> None:
    """Only one quarter on record: a 4-quarter growth figure has nothing to compare
    against and must not be measured over a shorter window instead."""
    s = category_history_settings
    q1 = _t22_master_frame([_t23_master_row("X1", "March-2026", "2026-03-31", 1000.0)])
    record_aum_history(q1, s)
    load_master(q1, s)
    with connect(s) as con:
        growth = compute_aum_growth(con)  # default 4-quarter lookback
    assert "X1" not in growth


def _aum_master(rows: list[tuple[str, str, float]]) -> pd.DataFrame:
    """scheme_code, fund_family_id, latest_aum triples sharing one clean_sub_category."""
    return pd.DataFrame(rows, columns=["scheme_code", "fund_family_id", "latest_aum"]).assign(
        clean_sub_category="Mid Cap Fund"
    )


def test_family_aum_exceeds_any_single_variant() -> None:
    master = _aum_master(
        [
            ("D1", "fam:1", 600.0),
            ("R1", "fam:1", 300.0),  # Direct and Regular twins of the same fund
            ("D2", "fam:2", 400.0),
        ]
    )
    family_latest = compute_aum_family_latest(master)
    by_code = dict(zip(master["scheme_code"], family_latest, strict=True))
    assert by_code["D1"] == by_code["R1"] == pytest.approx(900.0)
    assert by_code["D1"] > max(600.0, 300.0)  # the aggregate beats either variant alone
    assert by_code["D2"] == pytest.approx(400.0)


def test_aum_percentile_ranks_on_the_family_total_not_the_single_variant() -> None:
    master = _aum_master(
        [
            ("D1", "fam:1", 100.0),
            ("R1", "fam:1", 900.0),  # fam:1's true size is 1000, not 100
            ("D2", "fam:2", 200.0),
            ("D3", "fam:3", 300.0),
            ("D4", "fam:4", 400.0),
            ("D5", "fam:5", 500.0),
        ]
    )
    pct = compute_aum_percentile_in_sub_category(master, min_peers=5)
    by_code = dict(zip(master["scheme_code"], pct, strict=True))
    # D1 shares fam:1 with R1, whose combined AUM (1000) is the largest in the group,
    # so D1's percentile must reflect that, not its own tiny 100.
    assert by_code["D1"] == by_code["R1"] == pytest.approx(1.0)
    assert by_code["D2"] < by_code["D3"] < by_code["D4"] < by_code["D5"] < by_code["D1"]


def test_aum_percentile_withheld_below_min_peers() -> None:
    master = _aum_master([("D1", "fam:1", 100.0), ("D2", "fam:2", 200.0)])
    pct = compute_aum_percentile_in_sub_category(master, min_peers=5)
    assert pct.isna().all()


def _score_peers_with_aum() -> pd.DataFrame:
    return pd.DataFrame(
        {
            "scheme_code": ["A", "B", "C", "D", "E"],
            "sharpe_5y": [1.5, 0.8, 0.5, 1.2, 0.3],
            "sortino_5y": [1.9, 1.0, 0.6, 1.6, 0.4],
            "rolling_5y_median": [0.16, 0.12, 0.10, 0.14, 0.09],
            "quartile_persistence_3y": [0.9, 0.5, 0.4, 0.8, 0.3],
            "downside_capture_5y": [0.80, 0.95, 1.05, 0.85, 1.10],
            "max_drawdown_5y": [-0.18, -0.30, -0.35, -0.20, -0.40],
            "expense_ratio": [0.008, 0.015, 0.020, 0.010, 0.022],
            # A is the smallest fund by AUM percentile (best size discipline).
            "aum_percentile_in_sub_category": [0.1, 0.9, 0.5, 0.7, 0.3],
        }
    )


def test_size_discipline_scores_once_aum_percentile_is_present() -> None:
    """T2.3 wires the component scoring.py declared but never computed: with the
    column present, a fund is no longer flagged partial for it."""
    result = scoring.score_fund(_score_peers_with_aum(), "A")
    assert "size_discipline" not in result.missing
    comp = result.components["size_discipline"]
    assert comp.reason is None
    # A has the smallest AUM percentile (0.1, most disciplined), so it must rank best.
    assert comp.percentile == pytest.approx(1.0)
    assert comp.contribution == pytest.approx(scoring.COMPONENT_WEIGHTS["size_discipline"] * 100.0)
    assert result.status == "complete"


def test_aum_growth_is_measured_once_five_quarters_are_stored(tmp_path: Path) -> None:
    """T2.3's own column, from the table it reads rather than from a stub.

    Every row of the standard fixture has a null `aum_growth_4q`, because the master is
    ingested once and one quarter cannot be grown from. That is correct, but it left the
    populated path with no coverage at all.
    """
    from mf_analytics.pipeline import AUM_GROWTH_LOOKBACK_QUARTERS, compute_aum_growth

    settings = Settings(
        mf_data_dir=tmp_path / "data",
        mf_duckdb_path=tmp_path / "data" / "processed" / "aum.duckdb",
    )
    settings.ensure_dirs()
    quarters = [
        ("2025-03-31", 100.0),
        ("2025-06-30", 110.0),
        ("2025-09-30", 120.0),
        ("2025-12-31", 130.0),
        ("2026-03-31", 150.0),
    ]
    assert len(quarters) == AUM_GROWTH_LOOKBACK_QUARTERS + 1

    with connect(settings) as con:
        init_schema(con)
        for i, (date, aum) in enumerate(quarters):
            con.execute(
                "INSERT INTO scheme_aum_history "
                "(scheme_code, aum_quarter, aum_date, latest_aum, recorded_at) "
                "VALUES (?, ?, ?, ?, now())",
                ["A1", f"Q{i}", date, aum],
            )
        # One quarter short: withheld rather than measured over a shorter window.
        for i, (date, aum) in enumerate(quarters[1:]):
            con.execute(
                "INSERT INTO scheme_aum_history "
                "(scheme_code, aum_quarter, aum_date, latest_aum, recorded_at) "
                "VALUES (?, ?, ?, ?, now())",
                ["B1", f"Q{i}", date, aum],
            )
        growth = compute_aum_growth(con)

    # 150 from 100 across the four-quarter horizon, not 150 from the 110 next to it.
    assert growth["A1"] == pytest.approx(0.5)
    assert "B1" not in growth
