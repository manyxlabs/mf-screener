"""Total expense ratio, matched to scheme codes by name.

AMFI requires daily TER disclosure but publishes it per AMC behind a form, so the only
consolidated view is a scrape, and a scrape carries no scheme code and no ISIN - just
the fund's name. Everything here exists to make that join safe rather than plausible.

Three rules keep it honest. The match is exact on a normalised key, never fuzzy, so
"ICICI Prudential Long Term Fund" is left unmatched rather than paired with "ICICI
Prudential Long Term Bond Fund". A key that two source rows disagree on is dropped
whole. And TER is disclosed per plan, so a Direct scheme takes the Direct column and a
Regular scheme the Regular one; a scheme whose plan is Unknown gets neither.

The source is partial by nature. `run` reports what it covered so the gap is visible.
"""

from __future__ import annotations

import logging
import re
from datetime import UTC, datetime
from io import StringIO
from typing import Any, Final

import pandas as pd

from ..config import Settings, get_settings
from ..db import connect, init_schema
from ..http_client import client
from ..logging_setup import log_event

logger = logging.getLogger(__name__)

SCHEME_NAME_COLUMN: Final = "Scheme Name"
# The plan-specific columns. AMFI's headers are long and the scrape preserves them.
TER_COLUMNS: Final[dict[str, tuple[str, str]]] = {
    "Direct": ("Direct Plan - Total TER (%)", "Direct Plan - Base TER (%)"),
    "Regular": ("Regular Plan - Total TER (%)", "Regular Plan - Base TER (%)"),
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
_AND = re.compile(r"\band\b", re.I)
_NON_ALNUM = re.compile(r"[^a-z0-9]+")


class TerSourceError(RuntimeError):
    """The TER source could not be read, or did not carry the columns it must."""


def normalise_name(name: object) -> str:
    """A fund's identity with every plan/option variation stripped out."""
    text = _FORMERLY.sub(" ", str(name))
    text = re.sub(r"\(.*$", " ", text)
    text = _VARIANT_WORDS.sub(" ", text)
    # The source and AMFI's master spell one fund "Flexicap" and "Flexi Cap", or
    # "Large & Mid Cap" and "Large and Mid Cap", so spacing and "&" carry no identity.
    return _NON_ALNUM.sub("", _AND.sub(" ", text).lower())


def fetch_csv(settings: Settings | None = None) -> pd.DataFrame:
    s = settings or get_settings()
    with client(s) as http:
        response = http.get(s.mf_ter_csv_url)
        response.raise_for_status()
    frame = pd.read_csv(StringIO(response.text))
    required = {SCHEME_NAME_COLUMN, *(c for pair in TER_COLUMNS.values() for c in pair)}
    missing = required - set(frame.columns)
    if missing:
        raise TerSourceError(f"TER source is missing columns: {sorted(missing)}")
    return frame


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


def run(settings: Settings | None = None) -> dict[str, Any]:
    """Refresh the whole table from the source, and report the coverage it achieved."""
    s = settings or get_settings()
    lookup = build_lookup(fetch_csv(s))
    with connect(s) as con:
        init_schema(con)
        schemes = con.execute(
            "SELECT scheme_code, scheme_name, clean_plan, is_active FROM scheme_master"
        ).fetch_df()
        rows = match_schemes(lookup, schemes, s.mf_ter_csv_url)
        con.execute("DELETE FROM scheme_ter")
        if not rows.empty:
            con.register("ter_new", rows)
            con.execute(f"INSERT INTO scheme_ter SELECT {', '.join(_COLUMNS)} FROM ter_new")
            con.unregister("ter_new")
    active = schemes[schemes["is_active"].astype(str).str.lower().isin({"true", "1", "yes"})]
    matched_active = active["scheme_code"].astype(str).isin(set(rows["scheme_code"]))
    info = {
        "source_url": s.mf_ter_csv_url,
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
