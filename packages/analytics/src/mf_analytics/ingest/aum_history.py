"""Scheme-wise quarterly average AUM, straight from AMFI's own JSON endpoint.

The NAV feed carries one AUM figure per scheme - whatever quarter AMFI last published -
so `scheme_aum_history` could only ever accumulate forward, one quarter per quarter.
Fund flow, the change in a scheme's assets between quarters, therefore could not be
computed at all. AMFI serves the full history itself - 65 quarters back to June 2010 on
the first full run, 2026-09-12 - at

    GET /api/average-aum-schemewise?strType=Categorywise&fyId={fy}&periodId={p}&MF_ID=0

which is a JSON API rather than a page to scrape: no HTML parsing, no form automation,
one request per quarter. `fyId` counts financial years backwards from the current one
(1 = the newest) and `periodId` counts quarters backwards inside that year (1 = January
to March, 4 = April to June). A combination AMFI has not published answers 400 or a
`{"message": ...}` body, which is how the range below finds its own end.

Two conventions the payload does not state, both verified against the NAV feed's own
figures before this was written (Nippon India Small Cap, April-June 2026: AMFI
2,291,161.52 against the feed's 22,911.6152):

  - the amounts are in rupees LAKH, and the store keeps crore, so everything is / 100;
  - a scheme's AAUM is the sum of the two reported columns, not either one. A plain
    scheme carries it in "excluding FoF domestic but including FoF overseas" with zero
    in the other; a domestic fund-of-funds carries it the other way round.
"""

from __future__ import annotations

import logging
import re
import time
from datetime import date
from typing import Any, Final

import httpx

from ..config import Settings, get_settings
from ..db import append_aum_history_rows, connect, init_schema
from ..http_client import client, get_with_retry
from ..logging_setup import log_event

logger = logging.getLogger(__name__)

AAUM_PATH: Final = "/api/average-aum-schemewise"
# Both columns AMFI splits a scheme's assets across; a scheme reports in exactly one.
AUM_FIELDS: Final = (
    "ExcludingFundOfFundsDomesticButIncludingFundOfFundsOverseas",
    "FundOfFundsDomestic",
)
LAKH_PER_CRORE: Final = 100.0
# 1 is the current financial year and the list on AMFI's own page runs 21 deep.
MAX_FINANCIAL_YEARS: Final = 21
PERIODS: Final = (1, 2, 3, 4)

_PERIOD = re.compile(r"^\s*\w+\s*-\s*(\w+)\s+(\d{4})\s*$")
# AMFI's note says it published AAUM monthly up to September 2010, and it labels those
# periods with a single month ("March 2010") rather than a range. The quarterly series
# it actually serves reaches a little further back than that note implies - June 2010 -
# so where the monthly era begins is read off the labels, never assumed from the date.
# Those readings must not enter a quarterly series either way: aum_growth_4q counts four
# readings back, and a month among quarters would silently make that a shorter window.
_MONTHLY_PERIOD = re.compile(r"^\s*[A-Za-z]+\s+\d{4}\s*$")
_MONTH_END: Final[dict[str, tuple[int, int]]] = {
    "march": (3, 31),
    "june": (6, 30),
    "september": (9, 30),
    "december": (12, 31),
}


class AumSourceError(RuntimeError):
    """AMFI answered, but not with a quarter this importer can read."""


def is_pre_quarterly(label: str) -> bool:
    """Whether this is one of AMFI's pre-2011 monthly periods rather than a quarter."""
    return bool(_MONTHLY_PERIOD.match(label))


def parse_period(label: str) -> tuple[str, date]:
    """`"October - December 2019"` -> `("December-2019", date(2019, 12, 31))`.

    The label form matches what the NAV feed's own `aum_quarter` carries, so a quarter
    imported here and the same quarter seen by a master ingest are one row, not two.
    """
    match = _PERIOD.match(label)
    if not match:
        raise AumSourceError(f"Unreadable period label: {label!r}")
    month_name, year = match.group(1).lower(), int(match.group(2))
    if month_name not in _MONTH_END:
        raise AumSourceError(f"Period does not end on a quarter month: {label!r}")
    month, day = _MONTH_END[month_name]
    return f"{month_name.capitalize()}-{year}", date(year, month, day)


def rows_from_payload(payload: dict[str, Any]) -> tuple[list[dict[str, Any]], str]:
    """Flatten one quarter's AMC -> category -> scheme nesting into store rows."""
    label = str(payload.get("selectedPeriod") or "")
    quarter, quarter_end = parse_period(label)
    rows: list[dict[str, Any]] = []
    for block in payload.get("data") or []:
        for scheme in block.get("schemes") or []:
            amounts = scheme.get("AverageAumForTheMonth") or {}
            total = sum(float(amounts.get(field) or 0.0) for field in AUM_FIELDS)
            rows.append(
                {
                    "scheme_code": str(scheme["AMFI_Code"]),
                    "aum_quarter": quarter,
                    "aum_date": quarter_end,
                    "latest_aum": total / LAKH_PER_CRORE,
                }
            )
    return rows, quarter


def fetch_quarter(
    http: httpx.Client, settings: Settings, financial_year: int, period: int
) -> dict[str, Any] | None:
    """One quarter, or None where AMFI has not published that combination."""
    response = get_with_retry(
        http,
        f"{settings.mf_amfi_base_url.rstrip('/')}{AAUM_PATH}",
        {"strType": "Categorywise", "fyId": financial_year, "periodId": period, "MF_ID": 0},
        settings,
    )
    if response.status_code == 400:
        return None
    response.raise_for_status()
    payload = response.json()
    return payload if "data" in payload else None


def run(
    settings: Settings | None = None,
    financial_years: int = MAX_FINANCIAL_YEARS,
    pause_seconds: float = 1.0,
) -> dict[str, Any]:
    """Import every quarter AMFI publishes, newest first, into scheme_aum_history.

    Append-only: a quarter already recorded - by an earlier run of this, or by a master
    ingest that happened to see it - is left exactly as it was.
    """
    s = settings or get_settings()
    quarters: list[str] = []
    written = 0
    monthly_skipped = 0
    with client(s) as http:
        for financial_year in range(1, financial_years + 1):
            for period in PERIODS:
                payload = fetch_quarter(http, s, financial_year, period)
                if payload is None:
                    continue
                label = str(payload.get("selectedPeriod") or "")
                if is_pre_quarterly(label):
                    # Everything older is monthly too, but the walk is cheap and this
                    # keeps the end condition a property of the data, not of a date
                    # someone hard-coded.
                    monthly_skipped += 1
                    log_event(logger, "aum_history.pre_quarterly_skipped", period=label)
                    time.sleep(pause_seconds)
                    continue
                rows, quarter = rows_from_payload(payload)
                # A connection per quarter rather than one around the whole walk: the
                # store takes a write lock, and holding it for an 84-quarter import
                # would keep the API answering 503 for the duration.
                with connect(s) as con:
                    init_schema(con)
                    new = append_aum_history_rows(con, rows)
                written += new
                quarters.append(quarter)
                log_event(
                    logger,
                    "aum_history.quarter",
                    quarter=quarter,
                    schemes=len(rows),
                    new_rows=new,
                )
                # AMFI is a public utility serving one file per request, not an API with
                # a quota to spend; a second between calls costs a minute over the whole
                # history and keeps this a polite reader.
                time.sleep(pause_seconds)
    info = {
        "source_url": f"{s.mf_amfi_base_url.rstrip('/')}{AAUM_PATH}",
        "quarters": len(quarters),
        "oldest_quarter": quarters[-1] if quarters else None,
        "newest_quarter": quarters[0] if quarters else None,
        "new_rows": written,
        # Named rather than silent: the series stops here because AMFI published
        # monthly before this, not because the importer ran out of years to ask for.
        "pre_quarterly_periods_skipped": monthly_skipped,
    }
    log_event(logger, "aum_history.imported", **info)
    return info
