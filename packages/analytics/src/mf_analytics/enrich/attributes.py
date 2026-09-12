"""T3.2: scheme attributes that decide a shortlist - riskometer, exit load and its
period, lock-in period, minimum investment, minimum SIP, the benchmark named in the
scheme information document, fund manager, and manager start date.

Third-party, per the T3.1 fence: registered on `REGISTRY` like any other enrichment
table, never queried into `scheme_metrics_snapshot`, a ranking or a risk computation.
Screening on these fields (T3.2's own requirement - "these become screener filters")
happens by filtering the screen's *result set* against this table from the API layer,
never by joining a column from it into the snapshot query.

The candidate source (`mfdata.in`, the same one T3.3 evaluates for holdings) was
observed unreachable (HTTP 522) on first contact - see `docs/data-policy.md`. Its
per-scheme JSON shape is therefore assumed, not confirmed; `_FIELDS` is the one place
to correct it once the source answers. Every failure to fetch, and every field a
fetched row does not carry, resolves to a named reason - never a default.
"""

from __future__ import annotations

from datetime import UTC, date, datetime
from typing import Any, Final

from ..config import Settings, get_settings
from ..http_client import client
from . import (
    REGISTRY,
    Enriched,
    EnrichmentTable,
    EnrichReason,
    enrich_http_settings,
    fetch_or_reason,
)

SOURCE_NAME: Final = "mfdata.in"

# SEBI mandates a *monthly* riskometer disclosure, which is stricter than the general
# enrichment staleness threshold (`MF_ENRICH_STALE_DAYS`, default 45) every other
# enrichment field uses - so it gets its own, fixed threshold rather than reading the
# shared one.
RISKOMETER_STALE_DAYS: Final = 31

TABLE: Final[EnrichmentTable] = REGISTRY.register(
    EnrichmentTable(
        name="scheme_attributes",
        columns={
            "scheme_code": "VARCHAR NOT NULL",
            "riskometer": "VARCHAR",
            "riskometer_as_of": "DATE",
            "exit_load_pct": "DOUBLE",
            "exit_load_period_days": "INTEGER",
            "lock_in_days": "INTEGER",
            "min_investment": "DOUBLE",
            "min_sip": "DOUBLE",
            "benchmark_name": "VARCHAR",
            "fund_manager": "VARCHAR",
            "manager_start_date": "DATE",
        },
        key_columns=("scheme_code",),
        description=(
            "Scheme facts that decide a shortlist - riskometer, exit load, lock-in, "
            "minimum investment/SIP, SID benchmark and fund manager. One current row "
            "per scheme; never a return, risk or ranking input."
        ),
    )
)

# Cell-level reasons all reuse the generic `EnrichReason` vocabulary: a missing field
# on a fetched row and a fund the source never fetched are both "not carried" from the
# UI's point of view, and a fetch that failed outright is "unreachable" regardless of
# which field was being asked for.
REASON_DESCRIPTIONS: Final[dict[str, str]] = {
    EnrichReason.NOT_CARRIED: (
        "The enrichment source does not publish this fact for this scheme, so it is "
        "shown blank rather than assumed."
    ),
    EnrichReason.SOURCE_UNREACHABLE: (
        "The enrichment source could not be reached, so this value is a blank, not a zero."
    ),
    EnrichReason.STALE: (
        "SEBI requires the riskometer to be republished monthly; the value shown is "
        "older than that and may no longer reflect the fund's current risk band."
    ),
}

_FIELDS: Final = (
    "riskometer",
    "riskometer_as_of",
    "exit_load_pct",
    "exit_load_period_days",
    "lock_in_days",
    "min_investment",
    "min_sip",
    "benchmark_name",
    "fund_manager",
    "manager_start_date",
)

# The fields shown on a fund page and offered as screener filters, in the order
# `resolve` reports them - excludes the raw `manager_start_date` in favour of the
# derived `manager_tenure_years` a caller actually screens or displays on.
DISPLAY_FIELDS: Final = (
    "riskometer",
    "exit_load_pct",
    "exit_load_period_days",
    "lock_in_days",
    "min_investment",
    "min_sip",
    "benchmark_name",
    "fund_manager",
    "manager_tenure_years",
)


def _source_base_url(settings: Settings) -> str:
    return settings.mf_attributes_source_url.rstrip("/")


def _parse_date(value: Any) -> date | None:
    if value is None or isinstance(value, date):
        return value
    try:
        return datetime.fromisoformat(str(value)[:10]).date()
    except ValueError:
        return None


def _normalise(raw: dict[str, Any]) -> dict[str, Any]:
    out = {field: raw.get(field) for field in _FIELDS}
    out["riskometer_as_of"] = _parse_date(out["riskometer_as_of"])
    out["manager_start_date"] = _parse_date(out["manager_start_date"])
    return out


def _fetch_raw(scheme_code: str, settings: Settings) -> dict[str, Any] | None:
    """None on a 404 (the source answered: it does not carry this scheme) - anything
    else that goes wrong raises, for `fetch_or_reason` to turn into `SOURCE_UNREACHABLE`."""
    url = f"{_source_base_url(settings)}/schemes/{scheme_code}"
    with client(settings) as http:
        response = http.get(url)
    if response.status_code == 404:
        return None
    response.raise_for_status()
    return response.json()


def fetch_scheme_attributes(
    scheme_code: str, settings: Settings | None = None
) -> tuple[dict[str, Any] | None, str | None]:
    """One scheme's raw attribute fields from the source, or `(None, reason)`.

    `SOURCE_UNREACHABLE` says nothing about the fund; `NOT_CARRIED` is itself a fact
    about it (the source answered and has nothing) - kept distinct so the UI never
    reads "the internet is down" as "this fund has no exit load".
    """
    s = enrich_http_settings(settings or get_settings())
    raw, reason = fetch_or_reason(lambda: _fetch_raw(scheme_code, s))
    if reason is not None:
        return None, reason
    if raw is None:
        return None, EnrichReason.NOT_CARRIED
    return _normalise(raw), None


def manager_tenure_years(start_date: date | None, today: date | None = None) -> float | None:
    """Derived at query time, always - a tenure figure stored as a number would be
    wrong again the day after it was written."""
    if start_date is None:
        return None
    today = today or date.today()
    return round((today - start_date).days / 365.25, 2)


def resolve(row: dict[str, Any] | None, today: date | None = None) -> dict[str, Enriched]:
    """One `Enriched` per shortlist field, from a `scheme_attributes` row.

    `row=None` (the scheme has no row at all) resolves every field to `NOT_CARRIED`,
    the same reason an individual null column on a present row gets - from the UI's
    point of view "never fetched" and "fetched but blank" are the same fact.
    """
    today = today or date.today()
    row = row or {}
    as_of = row.get("as_of")
    out: dict[str, Enriched] = {}
    for field in (
        "exit_load_pct",
        "exit_load_period_days",
        "lock_in_days",
        "min_investment",
        "min_sip",
        "benchmark_name",
        "fund_manager",
    ):
        value = row.get(field)
        out[field] = (
            Enriched.missing(EnrichReason.NOT_CARRIED) if value is None else Enriched(value, as_of)
        )

    riskometer = row.get("riskometer")
    riskometer_as_of = row.get("riskometer_as_of")
    if riskometer is None:
        out["riskometer"] = Enriched.missing(EnrichReason.NOT_CARRIED)
    else:
        age_days = (today - riskometer_as_of).days if riskometer_as_of is not None else 0
        stale = age_days > RISKOMETER_STALE_DAYS
        reason = EnrichReason.STALE if stale else None
        out["riskometer"] = Enriched(riskometer, riskometer_as_of, reason, stale)

    manager_start = row.get("manager_start_date")
    tenure = manager_tenure_years(manager_start, today)
    out["manager_tenure_years"] = (
        Enriched.missing(EnrichReason.NOT_CARRIED) if tenure is None else Enriched(tenure, as_of)
    )
    return out


def run(scheme_codes: list[str] | None = None, settings: Settings | None = None) -> dict[str, Any]:
    """Refresh `scheme_attributes` one scheme at a time - the source, unlike TigZig's
    NAV/master downloads, offers no bulk endpoint. Meant for a scheduled job run by
    hand or cron (see the plan's note on why this project has no refresh daemon), not
    the request path.
    """
    from ..db import connect, init_schema  # deferred: db.py imports this package at load time

    s = settings or get_settings()
    now = datetime.now(UTC).replace(tzinfo=None)
    today = date.today()
    fetched = not_carried = unreachable = 0
    with connect(s) as con:
        init_schema(con)
        if scheme_codes is None:
            scheme_codes = [
                str(r[0]) for r in con.execute("SELECT scheme_code FROM scheme_master").fetchall()
            ]
        for code in scheme_codes:
            attrs, reason = fetch_scheme_attributes(code, s)
            if reason == EnrichReason.SOURCE_UNREACHABLE:
                unreachable += 1
                continue
            if attrs is None:
                not_carried += 1
                continue
            con.execute(
                f"INSERT OR REPLACE INTO {TABLE.name} "
                "(scheme_code, riskometer, riskometer_as_of, exit_load_pct, exit_load_period_days, "
                "lock_in_days, min_investment, min_sip, benchmark_name, fund_manager, "
                "manager_start_date, source, source_url, fetched_at, as_of) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                [
                    code,
                    attrs["riskometer"],
                    attrs["riskometer_as_of"],
                    attrs["exit_load_pct"],
                    attrs["exit_load_period_days"],
                    attrs["lock_in_days"],
                    attrs["min_investment"],
                    attrs["min_sip"],
                    attrs["benchmark_name"],
                    attrs["fund_manager"],
                    attrs["manager_start_date"],
                    SOURCE_NAME,
                    _source_base_url(s),
                    now,
                    today,
                ],
            )
            fetched += 1
    return {"fetched": fetched, "not_carried": not_carried, "unreachable": unreachable}
