"""The TER name join. Every test here guards against inventing a number."""

from __future__ import annotations

import pandas as pd
import pytest

from mf_analytics.ingest.ter import build_lookup, match_schemes, normalise_name

SOURCE_URL = "https://example.invalid/ter.csv"


def source_row(name: str, direct: float, regular: float) -> dict[str, object]:
    return {
        "Scheme Name": name,
        "Direct Plan - Total TER (%)": direct,
        "Direct Plan - Base TER (%)": direct - 0.03,
        "Regular Plan - Total TER (%)": regular,
        "Regular Plan - Base TER (%)": regular - 0.03,
    }


def schemes(*rows: tuple[str, str, str]) -> pd.DataFrame:
    return pd.DataFrame(rows, columns=["scheme_code", "scheme_name", "clean_plan"])


@pytest.mark.parametrize(
    ("filed_as", "disclosed_as"),
    [
        ("Acme Flexicap Fund - Direct Plan - Growth", "Acme Flexicap Fund"),
        ("Acme Flexicap Fund -Regular - Quarterly IDCW", "Acme Flexicap Fund"),
        ("Acme Flexicap Fund - Growth Option - Direct Plan", "Acme Flexicap Fund"),
        ("Acme Flexicap Fund (Formerly Known as Zeta Flexicap)", "Acme Flexicap Fund"),
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
    assert lookup.loc["acme flexicap fund", "Direct Plan - Total TER (%)"] == pytest.approx(0.0043)


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
    assert "acme flexicap fund" not in lookup.index


def test_identical_duplicates_are_kept_since_they_disagree_about_nothing() -> None:
    lookup = build_lookup(
        pd.DataFrame([source_row("Acme Flexicap Fund", 0.43, 1.95)] * 2),
    )
    assert lookup.loc["acme flexicap fund", "Direct Plan - Total TER (%)"] == pytest.approx(0.0043)


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
    assert "acme flexicap fund" in lookup.index
