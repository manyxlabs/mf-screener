"""The TER name join. Every test here guards against inventing a number."""

from __future__ import annotations

from datetime import date
from io import BytesIO

import pandas as pd
import pytest

from mf_analytics.ingest.ter import (
    DATE_COLUMN,
    SCHEME_CODE_COLUMN,
    SCHEME_NAME_COLUMN,
    TER_COLUMNS,
    TerSourceError,
    build_lookup,
    disclosure_months,
    match_schemes,
    normalise_name,
    read_disclosure,
)

SOURCE_URL = "https://example.invalid/api/populate-te-rdata-revised"


def source_row(name: str, direct: float, regular: float) -> dict[str, object]:
    (direct_total, direct_base), (regular_total, regular_base) = (
        TER_COLUMNS["Direct"],
        TER_COLUMNS["Regular"],
    )
    return {
        SCHEME_NAME_COLUMN: name,
        direct_total: direct,
        direct_base: direct - 0.03,
        regular_total: regular,
        regular_base: regular - 0.03,
    }


def excel(rows: list[dict[str, object]]) -> bytes:
    buffer = BytesIO()
    pd.DataFrame(rows).to_excel(buffer, index=False)
    return buffer.getvalue()


def test_only_each_schemes_latest_day_is_kept() -> None:
    """AMFI files a row per scheme per day, and TER moves within a month."""
    content = excel(
        [
            {
                SCHEME_CODE_COLUMN: "A/1",
                DATE_COLUMN: "2026-09-10",
                **source_row("Acme Fund", 0.50, 1.50),
            },
            {
                SCHEME_CODE_COLUMN: "A/1",
                DATE_COLUMN: "2026-09-11",
                **source_row("Acme Fund", 0.45, 1.40),
            },
            {
                SCHEME_CODE_COLUMN: "B/1",
                DATE_COLUMN: "2026-09-09",
                **source_row("Beta Fund", 0.30, 1.10),
            },
        ]
    )
    frame = read_disclosure(content).set_index(SCHEME_CODE_COLUMN)
    assert len(frame) == 2
    assert frame.loc["A/1", TER_COLUMNS["Direct"][0]] == pytest.approx(0.45)
    # A scheme that did not file on the newest day keeps its own latest disclosure.
    assert frame.loc["B/1", DATE_COLUMN] == pd.Timestamp("2026-09-09")


def test_an_archived_month_is_read_by_name_under_its_old_column_names() -> None:
    """Before 2025 AMFI left the NSDL code blank and filed the base figure as Base TER."""

    def archived(name: str, day: str, direct: float) -> dict[str, object]:
        row = {SCHEME_CODE_COLUMN: None, DATE_COLUMN: day, **source_row(name, direct, 1.5)}
        for plan, (_, base) in TER_COLUMNS.items():
            row[f"{plan} Plan - Base TER (%)"] = row.pop(base)
        return row

    content = excel(
        [
            archived("Acme Fund", "2019-08-30", 0.50),
            archived("Acme Fund", "2019-08-31", 0.45),
            archived("Beta Fund", "2019-08-31", 0.30),
        ]
    )
    frame = read_disclosure(content).set_index(SCHEME_NAME_COLUMN)
    assert len(frame) == 2
    assert frame.loc["Acme Fund", TER_COLUMNS["Direct"][0]] == pytest.approx(0.45)
    assert frame.loc["Beta Fund", TER_COLUMNS["Direct"][1]] == pytest.approx(0.27)


def test_an_amc_with_nothing_filed_reads_as_empty_not_as_an_error() -> None:
    """AMFI answers that case with the header over blank rows."""
    header = {SCHEME_CODE_COLUMN: None, DATE_COLUMN: None, **source_row("", 0, 0)}
    header[SCHEME_NAME_COLUMN] = None
    assert read_disclosure(excel([header])).empty


def test_a_disclosure_missing_a_ter_column_is_refused() -> None:
    row = {
        SCHEME_CODE_COLUMN: "A/1",
        DATE_COLUMN: "2026-09-10",
        **source_row("Acme Fund", 0.5, 1.5),
    }
    del row[TER_COLUMNS["Direct"][0]]
    with pytest.raises(TerSourceError, match="Direct Plan - Total TER"):
        read_disclosure(excel([row]))


def test_the_first_days_of_a_month_fall_back_to_the_previous_month() -> None:
    assert disclosure_months(date(2026, 1, 2)) == ("01-2026", "12-2025")


def schemes(*rows: tuple[str, str, str]) -> pd.DataFrame:
    return pd.DataFrame(rows, columns=["scheme_code", "scheme_name", "clean_plan"])


@pytest.mark.parametrize(
    ("filed_as", "disclosed_as"),
    [
        ("Acme Flexicap Fund - Direct Plan - Growth", "Acme Flexicap Fund"),
        ("Acme Flexicap Fund -Regular - Quarterly IDCW", "Acme Flexicap Fund"),
        ("Acme Flexicap Fund - Growth Option - Direct Plan", "Acme Flexicap Fund"),
        ("Acme Flexicap Fund (Formerly Known as Zeta Flexicap)", "Acme Flexicap Fund"),
        ("Acme Flexi Cap Fund - Direct Plan - Growth", "Acme Flexicap Fund"),
        ("Acme Large & Mid Cap Fund - Direct - Growth", "Acme Large and Mid Cap Fund"),
        # SEBI's debt category renames: the master can lag AMFI's disclosure.
        ("Acme Ultra Short Duration Fund - Direct - Growth", "Acme Ultra Short Term Fund"),
        ("Acme Medium to Long Duration Fund - Regular", "Acme Medium to Long Term Fund"),
        ("Acme Dynamic Bond Fund - Direct Plan", "Acme Dynamic Term Fund"),
        ("Acme Floating Rate Fund - Direct - IDCW", "Acme Floating Interest Rates Fund"),
        ("Acme Gilt Securities Fund - Regular Plan", "Acme Gilt Fund"),
    ],
)
def test_plan_and_option_variants_reduce_to_one_fund(filed_as: str, disclosed_as: str) -> None:
    """TER is disclosed per fund, so every variant of it has to reach the same key."""
    assert normalise_name(filed_as) == normalise_name(disclosed_as)


def test_a_longer_name_is_a_different_fund() -> None:
    """The join is exact. 'Long Term' and 'Long Term Bond' are two real, distinct funds."""
    assert normalise_name("Acme Long Term Fund") != normalise_name("Acme Long Term Bond Fund")


def test_percentages_are_stored_as_fractions() -> None:
    """A TER of 0.43 alongside a CAGR of 0.48 would read as a 43% charge."""
    lookup = build_lookup(pd.DataFrame([source_row("Acme Flexicap Fund", 0.43, 1.95)]))
    assert lookup.loc[
        normalise_name("Acme Flexicap Fund"), "Direct Plan - Total TER (%)"
    ] == pytest.approx(0.0043)


def test_a_key_two_source_rows_disagree_on_is_dropped_whole() -> None:
    """Nothing in the file chooses between them, so the fund goes unpriced."""
    lookup = build_lookup(
        pd.DataFrame(
            [
                source_row("Acme Flexicap Fund", 0.43, 1.95),
                source_row("Acme Flexicap Fund - Growth", 0.71, 1.95),
            ]
        )
    )
    assert normalise_name("Acme Flexicap Fund") not in lookup.index


def test_identical_duplicates_are_kept_since_they_disagree_about_nothing() -> None:
    lookup = build_lookup(
        pd.DataFrame([source_row("Acme Flexicap Fund", 0.43, 1.95)] * 2),
    )
    assert lookup.loc[
        normalise_name("Acme Flexicap Fund"), "Direct Plan - Total TER (%)"
    ] == pytest.approx(0.0043)


def test_each_plan_takes_its_own_disclosed_ratio() -> None:
    """The Direct/Regular gap is the whole point of the column; mixing them inverts it."""
    lookup = build_lookup(pd.DataFrame([source_row("Acme Flexicap Fund", 0.43, 1.95)]))
    rows = match_schemes(
        lookup,
        schemes(
            ("S1", "Acme Flexicap Fund - Direct Plan - Growth", "Direct"),
            ("S2", "Acme Flexicap Fund - Regular Plan - Growth", "Regular"),
        ),
        SOURCE_URL,
    ).set_index("scheme_code")
    assert rows.loc["S1", "expense_ratio"] == pytest.approx(0.0043)
    assert rows.loc["S2", "expense_ratio"] == pytest.approx(0.0195)


def test_a_scheme_with_an_unknown_plan_is_left_unpriced() -> None:
    """Pre-2013 schemes predate the Direct/Regular split, so neither column is theirs."""
    lookup = build_lookup(pd.DataFrame([source_row("Acme Flexicap Fund", 0.43, 1.95)]))
    rows = match_schemes(lookup, schemes(("S1", "Acme Flexicap Fund", "Unknown")), SOURCE_URL)
    assert rows.empty


def test_an_undisclosed_fund_is_absent_rather_than_zero() -> None:
    lookup = build_lookup(pd.DataFrame([source_row("Acme Flexicap Fund", 0.43, 1.95)]))
    rows = match_schemes(
        lookup, schemes(("S9", "Beta Smallcap Fund - Direct Plan - Growth", "Direct")), SOURCE_URL
    )
    assert rows.empty


def test_one_disclosure_reaches_every_scheme_code_of_that_fund_and_plan() -> None:
    """Growth and IDCW are the same fund at the same cost, filed under separate codes."""
    lookup = build_lookup(pd.DataFrame([source_row("Acme Flexicap Fund", 0.43, 1.95)]))
    rows = match_schemes(
        lookup,
        schemes(
            ("S1", "Acme Flexicap Fund - Direct Plan - Growth", "Direct"),
            ("S2", "Acme Flexicap Fund - Direct Plan - IDCW Payout", "Direct"),
            ("S3", "Acme Flexicap Fund - Direct - Monthly IDCW", "Direct"),
        ),
        SOURCE_URL,
    )
    assert set(rows["scheme_code"]) == {"S1", "S2", "S3"}
    assert rows["expense_ratio"].nunique() == 1


def test_a_direct_plan_priced_above_its_regular_plan_is_withheld() -> None:
    """SEBI leaves no distributor commission in a Direct plan, so it cannot cost more."""
    lookup = build_lookup(pd.DataFrame([source_row("Acme Flexicap Fund", 2.60, 2.55)]))
    assert lookup.empty


def test_an_equally_priced_pair_is_kept() -> None:
    """Only a strictly inverted pair is impossible; a zero gap is merely unusual."""
    lookup = build_lookup(pd.DataFrame([source_row("Acme Flexicap Fund", 1.00, 1.00)]))
    assert normalise_name("Acme Flexicap Fund") in lookup.index
