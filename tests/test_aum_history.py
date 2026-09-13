"""AMFI's AAUM payload -> scheme_aum_history, with no network in the test."""

from __future__ import annotations

from datetime import date
from pathlib import Path
from typing import Any

import duckdb
import pytest

from mf_analytics.config import Settings
from mf_analytics.db import append_aum_history_rows, connect, init_schema
from mf_analytics.ingest.aum_history import (
    AUM_FIELDS,
    AumSourceError,
    is_pre_quarterly,
    parse_period,
    rows_from_payload,
)

EXCLUDING_FOF, FOF_DOMESTIC = AUM_FIELDS


def _payload() -> dict[str, Any]:
    """One AMC, two schemes, shaped exactly as the live endpoint returns them.

    The amounts are in lakh, and a domestic fund-of-funds reports in the second column
    while everything else reports in the first - both verified against the NAV feed.
    """
    return {
        "selectedPeriod": "October - December 2019",
        "data": [
            {
                "strMFId": "0",
                "Mfname": "Nippon India Mutual Fund",
                "SchemeCat_Desc": "Growth/Equity Oriented Schemes - Small Cap Fund",
                "schemes": [
                    {
                        "SchemeNAVName": "Nippon India Small Cap Fund - Direct Plan Growth",
                        "AMFI_Code": 118778,
                        "AverageAumForTheMonth": {EXCLUDING_FOF: 2291161.52, FOF_DOMESTIC: 0},
                    },
                    {
                        "SchemeNAVName": "Motilal Oswal Nasdaq 100 Fund of Fund - Direct",
                        "AMFI_Code": 145552,
                        "AverageAumForTheMonth": {EXCLUDING_FOF: 0, FOF_DOMESTIC: 457231.11},
                    },
                ],
            }
        ],
    }


def test_a_quarter_label_becomes_the_same_key_the_nav_feed_uses() -> None:
    assert parse_period("October - December 2019") == ("December-2019", date(2019, 12, 31))
    assert parse_period("April - June 2026") == ("June-2026", date(2026, 6, 30))
    assert parse_period("January - March 2020") == ("March-2020", date(2020, 3, 31))


def test_a_period_that_is_not_a_quarter_is_refused_rather_than_guessed() -> None:
    with pytest.raises(AumSourceError):
        parse_period("July 2010")


def test_amfis_pre_2011_monthly_periods_are_recognised_and_skipped() -> None:
    """A month among quarters would make aum_growth_4q a shorter window than it claims."""
    assert is_pre_quarterly("March 2010")
    assert is_pre_quarterly(" September 2009 ")
    assert not is_pre_quarterly("January - March 2020")
    assert not is_pre_quarterly("")


def test_amounts_are_converted_from_lakh_and_summed_across_both_columns() -> None:
    rows, quarter = rows_from_payload(_payload())
    assert quarter == "December-2019"
    by_code = {r["scheme_code"]: r for r in rows}
    # The figure the NAV feed carries for this scheme and quarter, to the last digit.
    assert by_code["118778"]["latest_aum"] == pytest.approx(22911.6152)
    # A domestic fund-of-funds reports in the other column; taking one column would zero it.
    assert by_code["145552"]["latest_aum"] == pytest.approx(4572.3111)
    assert by_code["118778"]["aum_date"] == date(2019, 12, 31)


def test_import_is_append_only_across_repeated_runs(tmp_path: Path) -> None:
    settings = Settings(
        mf_data_dir=tmp_path / "data", mf_duckdb_path=tmp_path / "data" / "processed" / "a.duckdb"
    )
    settings.ensure_dirs()
    rows, _ = rows_from_payload(_payload())
    with connect(settings) as con:
        init_schema(con)
        assert append_aum_history_rows(con, rows) == 2
        # A quarter already recorded must not be rewritten by a later run.
        assert append_aum_history_rows(con, rows) == 0

    with duckdb.connect(str(settings.mf_duckdb_path), read_only=True) as con:
        stored = con.execute(
            "SELECT count(*), count(DISTINCT aum_quarter) FROM scheme_aum_history"
        ).fetchone()
    assert stored == (2, 1)
