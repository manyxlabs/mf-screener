"""Total expense ratio, from AMFI's own daily TER disclosures, matched to scheme codes by name.

AMFI publishes every AMC's TER daily. Its TER page reads

    GET /api/populate-te-rdata-revised?MF_ID={amc}&Month={MM-YYYY}&strCat=-1&strType=-1&excel=true

which answers one AMC's month as an Excel file, one row per scheme per day. The JSON form
of the same endpoint pages 100 rows at a time sorted by scheme rather than date, so a
month of it costs hundreds of requests where the file costs one per AMC. `MF_ID=-1` - the
page's own "All" option - answers an empty file, so each AMC is asked for by id, from the
list the page itself reads at `/api/populate-mf`.

The disclosure carries an NSDL scheme code but no AMFI code and no ISIN, so the join to
scheme_master is by name, and everything below exists to make that join safe rather
than plausible. The match is exact on a normalised key, never fuzzy, so "ICICI
Prudential Long Term Fund" is left unmatched rather than paired with "ICICI Prudential
Long Term Bond Fund". A key that two source rows disagree on is dropped whole. And TER is
disclosed per plan, so a Direct scheme takes the Direct column and a Regular scheme the
Regular one; a scheme whose plan is Unknown gets neither.
"""

from __future__ import annotations

import logging
import re
import time
from collections.abc import Sequence
from datetime import UTC, date, datetime, timedelta
from io import BytesIO
from typing import Any, Final

import pandas as pd

from ..config import Settings, get_settings
from ..db import connect, init_schema
from ..http_client import client, get_with_retry
from ..logging_setup import log_event

logger = logging.getLogger(__name__)

TER_PATH: Final = "/api/populate-te-rdata-revised"
FUND_HOUSES_PATH: Final = "/api/populate-mf"
SCHEME_NAME_COLUMN: Final = "Scheme Name"
SCHEME_CODE_COLUMN: Final = "NSDL Scheme Code"
DATE_COLUMN: Final = "TER Date"
# (total, base) per plan. SEBI's 2026 regulations replaced "Base TER" with the Base
# Expense Ratio, which is what AMFI now files and what `base_ter` stores.
TER_COLUMNS: Final[dict[str, tuple[str, str]]] = {
    "Direct": ("Direct Plan - Total TER (%)", "Direct Plan - Base Expense Ratio (BER) (%)"),
    "Regular": ("Regular Plan - Total TER (%)", "Regular Plan - Base Expense Ratio (BER) (%)"),
}
# The same figure under its pre-2026 name, which every archived month is filed with.
_PRE_2026_BASE_COLUMNS: Final = {
    f"{plan} Plan - Base TER (%)": base for plan, (_, base) in TER_COLUMNS.items()
}

_FORMERLY = re.compile(r"\(\s*(?:formerly|erstwhile)[^)]*\)?", re.I)
# Plan, option and payout-frequency words describe a variant of a fund, not a different
# fund, and TER is disclosed at the fund level. Stripping them is what lets one source
# row reach the several scheme codes it actually priced.
_VARIANT_WORDS = re.compile(
    r"\b(direct|regular|retail|growth|cumulative|idcw|dividend|div|payout|pay\s?out|"
    r"re\s?investment|re\s?invest|bonus|option|options|plan|plans|"
    r"daily|weekly|fortnightly|monthly|quarterly|half\s?yearly|annual|yearly|"
    r"institutional|super|segregated|portfolio)\b",
    re.I,
)
# SEBI renamed the debt categories and AMFI's disclosure already files the new names,
# while the scheme master can still carry the old ones ("Axis Short Duration Fund" is
# disclosed as "Axis Short Term Fund"). Only whole-category renames belong here: a
# fund-specific rename applied to every name would pair funds that are not the same.
_CATEGORY_RENAMES: Final = (
    (re.compile(r"\b(short|medium|long) duration\b", re.I), r"\1 term"),
    (re.compile(r"\bdynamic bond\b", re.I), "dynamic term"),
    (re.compile(r"\bfloating rate\b", re.I), "floating interest rates"),
    (re.compile(r"\bgilt securities\b", re.I), "gilt"),
)
_AND = re.compile(r"\band\b", re.I)
_NON_ALNUM = re.compile(r"[^a-z0-9]+")


class TerSourceError(RuntimeError):
    """The TER source could not be read, or did not carry the columns it must."""


def normalise_name(name: object) -> str:
    """A fund's identity with every plan/option variation stripped out."""
    text = _FORMERLY.sub(" ", str(name))
    text = re.sub(r"\(.*$", " ", text)
    for pattern, replacement in _CATEGORY_RENAMES:
        text = pattern.sub(replacement, text)
    text = _VARIANT_WORDS.sub(" ", text)
    # The source and AMFI's master spell one fund "Flexicap" and "Flexi Cap", or
    # "Large & Mid Cap" and "Large and Mid Cap", so spacing and "&" carry no identity.
    return _NON_ALNUM.sub("", _AND.sub(" ", text).lower())


def disclosure_months(today: date) -> tuple[str, str]:
    """This month, then last month: on the first days of a month an AMC may not have
    filed yet, and its latest disclosure is last month's final one."""
    previous = today.replace(day=1) - timedelta(days=1)
    return f"{today:%m-%Y}", f"{previous:%m-%Y}"


def read_disclosure(content: bytes) -> pd.DataFrame:
    """One AMC's month as filed, reduced to each scheme's latest day."""
    frame = pd.read_excel(BytesIO(content)).rename(columns=_PRE_2026_BASE_COLUMNS)
    required = {
        SCHEME_NAME_COLUMN,
        SCHEME_CODE_COLUMN,
        DATE_COLUMN,
        *(c for pair in TER_COLUMNS.values() for c in pair),
    }
    missing = required - set(frame.columns)
    if missing:
        raise TerSourceError(f"TER disclosure is missing columns: {sorted(missing)}")
    # An AMC with nothing filed for the month answers the header over blank rows.
    frame = frame.dropna(subset=[DATE_COLUMN, SCHEME_NAME_COLUMN])
    frame[DATE_COLUMN] = pd.to_datetime(frame[DATE_COLUMN])
    # Files before 2025 leave the NSDL code blank, and the join is by name anyway.
    scheme = frame[SCHEME_CODE_COLUMN].fillna(frame[SCHEME_NAME_COLUMN])
    # Every day of the month is a row, and TERs move within it, so only the latest day
    # is the current price; keeping the rest would make every fund disagree with itself.
    latest = frame.assign(_scheme=scheme).sort_values(DATE_COLUMN)
    return latest.drop_duplicates("_scheme", keep="last").drop(columns="_scheme")


def fetch_disclosures(
    settings: Settings, pause_seconds: float, months: Sequence[str]
) -> tuple[pd.DataFrame, int, int]:
    """Each AMC's disclosure for the first of `months` it filed, the number of AMCs asked,
    and how many filed none of them."""
    base = settings.mf_amfi_base_url.rstrip("/")
    frames: list[pd.DataFrame] = []
    without = 0
    with client(settings) as http:
        response = get_with_retry(http, f"{base}{FUND_HOUSES_PATH}", None, settings)
        response.raise_for_status()
        houses = response.json()
        for house in houses:
            for month in months:
                response = get_with_retry(
                    http,
                    f"{base}{TER_PATH}",
                    {
                        "MF_ID": house["mfId"],
                        "Month": month,
                        "strCat": -1,
                        "strType": -1,
                        "excel": "true",
                    },
                    settings,
                )
                response.raise_for_status()
                frame = read_disclosure(response.content)
                # One file per request from a public utility: a pause keeps this polite.
                time.sleep(pause_seconds)
                if not frame.empty:
                    frames.append(frame)
                    break
            else:
                without += 1
    if not frames:
        raise TerSourceError("AMFI returned no TER disclosure for any fund house")
    return pd.concat(frames, ignore_index=True), len(houses), without


def build_lookup(raw: pd.DataFrame) -> pd.DataFrame:
    """One row per unambiguous fund key, in fractions rather than percent.

    Every other percent in this app is a fraction, and a TER stored as 0.43 next to a
    CAGR stored as 0.48 would render as 43% cost against a 48% return.
    """
    frame = raw.copy()
    frame["match_key"] = frame[SCHEME_NAME_COLUMN].map(normalise_name)
    frame = frame[frame["match_key"] != ""]

    value_columns = [total for total, _ in TER_COLUMNS.values()]
    for column in value_columns:
        frame[column] = pd.to_numeric(frame[column], errors="coerce") / 100.0
    for _, base in TER_COLUMNS.values():
        frame[base] = pd.to_numeric(frame[base], errors="coerce") / 100.0

    # Two rows under one key that disagree cannot both be right and there is nothing in
    # the file to choose between them, so the fund goes unpriced rather than guessed.
    disagreeing = frame.groupby("match_key")[value_columns].nunique().max(axis=1) > 1
    ambiguous = set(disagreeing[disagreeing].index)
    frame = frame[~frame["match_key"].isin(ambiguous)]

    # A Direct plan pays no distributor commission, so it cannot cost more than the
    # Regular plan of the same fund. Where it does, one of the two figures is wrong and
    # the file offers no way to tell which, so neither is published.
    direct, regular = TER_COLUMNS["Direct"][0], TER_COLUMNS["Regular"][0]
    frame = frame[~(frame[direct] > frame[regular])]
    return frame.drop_duplicates("match_key").set_index("match_key")


def match_schemes(lookup: pd.DataFrame, schemes: pd.DataFrame, source_url: str) -> pd.DataFrame:
    """Join scheme codes to the fund-level TER their plan was priced at."""
    matched: list[dict[str, Any]] = []
    now = datetime.now(UTC).replace(tzinfo=None)
    keys = schemes["scheme_name"].map(normalise_name)
    for (code, plan), key in zip(
        zip(schemes["scheme_code"], schemes["clean_plan"], strict=True), keys, strict=True
    ):
        columns = TER_COLUMNS.get(str(plan))
        if columns is None or key not in lookup.index:
            continue
        row = lookup.loc[key]
        total, base = row[columns[0]], row[columns[1]]
        if pd.isna(total):
            continue
        matched.append(
            {
                "scheme_code": str(code),
                "expense_ratio": float(total),
                "base_ter": None if pd.isna(base) else float(base),
                "plan": str(plan),
                "source_scheme_name": str(row[SCHEME_NAME_COLUMN]),
                "match_key": key,
                "source_url": source_url,
                "imported_at": now,
            }
        )
    return pd.DataFrame(matched, columns=list(_COLUMNS))


_COLUMNS: Final = (
    "scheme_code",
    "expense_ratio",
    "base_ter",
    "plan",
    "source_scheme_name",
    "match_key",
    "source_url",
    "imported_at",
)


def run(settings: Settings | None = None, pause_seconds: float = 1.0) -> dict[str, Any]:
    """Refresh the whole table from AMFI, and report the coverage it achieved."""
    s = settings or get_settings()
    source_url = f"{s.mf_amfi_base_url.rstrip('/')}{TER_PATH}"
    raw, houses, without = fetch_disclosures(s, pause_seconds, disclosure_months(date.today()))
    lookup = build_lookup(raw)
    with connect(s) as con:
        init_schema(con)
        schemes = con.execute(
            "SELECT scheme_code, scheme_name, clean_plan, is_active FROM scheme_master"
        ).fetch_df()
        rows = match_schemes(lookup, schemes, source_url)
        con.execute("DELETE FROM scheme_ter")
        if not rows.empty:
            con.register("ter_new", rows)
            con.execute(f"INSERT INTO scheme_ter SELECT {', '.join(_COLUMNS)} FROM ter_new")
            con.unregister("ter_new")
    active = schemes[schemes["is_active"].astype(str).str.lower().isin({"true", "1", "yes"})]
    matched_active = active["scheme_code"].astype(str).isin(set(rows["scheme_code"]))
    info = {
        "source_url": source_url,
        "fund_houses": houses,
        "fund_houses_without_disclosure": without,
        "oldest_ter_date": str(raw[DATE_COLUMN].min().date()),
        "newest_ter_date": str(raw[DATE_COLUMN].max().date()),
        "source_funds": len(lookup),
        "matched_schemes": len(rows),
        "active_schemes": len(active),
        "matched_active_schemes": int(matched_active.sum()),
        "active_coverage_pct": round(100.0 * float(matched_active.mean()), 1)
        if len(active)
        else 0.0,
    }
    log_event(logger, "ter.imported", **info)
    return info


# The first month AMFI's TER archive holds a filing for.
HISTORY_START: Final = date(2018, 6, 1)


def run_history(settings: Settings | None = None, pause_seconds: float = 1.0) -> dict[str, Any]:
    """Each fund's TER as it stood at every past month-end, for point-in-time backtests.

    `scheme_ter` holds only today's price, so a backtest reading it prices a 2019 ranking
    with a 2026 fee. Append-only and resumable: a month already stored is never fetched
    again, and a month AMFI has nothing for is skipped and retried on the next run rather
    than failing the rest. The current month is left to `run`, since it is still filing.
    """
    s = settings or get_settings()
    source_url = f"{s.mf_amfi_base_url.rstrip('/')}{TER_PATH}"
    last_complete = date.today().replace(day=1) - timedelta(days=1)
    months = pd.date_range(HISTORY_START, last_complete, freq="ME")
    with connect(s) as con:
        init_schema(con)
        stored = {
            row[0]
            for row in con.execute("SELECT DISTINCT ter_month FROM scheme_ter_history").fetchall()
        }
        schemes = con.execute(
            "SELECT scheme_code, scheme_name, clean_plan FROM scheme_master"
        ).fetch_df()
    written, empty = 0, []
    for month_end in months:
        if month_end.date() in stored:
            continue
        try:
            raw, _, _ = fetch_disclosures(s, pause_seconds, (f"{month_end:%m-%Y}",))
        except TerSourceError:
            empty.append(f"{month_end:%Y-%m}")
            continue
        rows = match_schemes(build_lookup(raw), schemes, source_url).assign(
            ter_month=month_end.date()
        )
        with connect(s) as con:
            con.register("ter_month_new", rows)
            con.execute(
                f"INSERT INTO scheme_ter_history SELECT ter_month, {', '.join(_COLUMNS)} "
                "FROM ter_month_new"
            )
            con.unregister("ter_month_new")
        written += 1
        log_event(logger, "ter_history.month", month=f"{month_end:%Y-%m}", schemes=len(rows))
    info = {"months_written": written, "months_already_stored": len(stored), "months_empty": empty}
    log_event(logger, "ter_history.imported", **info)
    return info
