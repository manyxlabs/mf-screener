"""T3.3: `scheme_holdings`, portfolio concentration, turnover and fund-to-fund overlap.

Third-party, per the T3.1 fence: registered on `REGISTRY` like `scheme_attributes`,
never read into `scheme_metrics_snapshot`, a ranking or a risk computation. What a
fund holds is a month-old photograph filed by its AMC; it is not a return, and nothing
computed here may become one.

**No holdings data ships, and none is fetched.** The candidate source (`mfdata.in`) was
probed read-only again on 2026-09-12 and returned HTTP 522 on `/`, `/docs` and
`/openapi.json`, exactly as on 2026-09-09 - see `docs/data-policy.md`. Scraping AMC
sites, browser automation and paid APIs are refused by that same policy. So this module
ships the engine and a strict import contract and nothing else, the way `benchmarks`
already does for index series: `make holdings-validate` / `make holdings-import` load a
file the operator legitimately has. `fetch_scheme_holdings` below is the dormant
adapter for the day the source becomes reliable; nothing calls it.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, date, datetime
from itertools import combinations, pairwise
from pathlib import Path
from typing import Any, Final

import pandas as pd

from ..config import Settings, get_settings
from ..http_client import client
from . import REGISTRY, EnrichmentTable, EnrichReason, enrich_http_settings, fetch_or_reason
from .holdings_csv import HoldingsCsvError, read_and_validate

SOURCE_NAME: Final = "mfdata.in"

TABLE: Final[EnrichmentTable] = REGISTRY.register(
    EnrichmentTable(
        name="scheme_holdings",
        columns={
            "scheme_code": "VARCHAR NOT NULL",
            # The identity a holding is matched on across funds and across months: the
            # published id where the file carries one, the instrument name otherwise.
            # Separate from `instrument_id` because the primary key cannot be null and
            # a name standing in for an ISIN must not be mistaken for one.
            "instrument_key": "VARCHAR NOT NULL",
            "instrument_id": "VARCHAR",
            "instrument_name": "VARCHAR NOT NULL",
            "weight": "DOUBLE NOT NULL",
            "quantity": "DOUBLE",
            "market_value": "DOUBLE",
            "sector": "VARCHAR",
            "asset_type": "VARCHAR",
        },
        key_columns=("scheme_code", "as_of", "instrument_key"),
        description=(
            "One row per instrument per scheme per disclosure month. `weight` is a "
            "fraction of net assets, never a percentage. Enrichment: never a return, "
            "risk or ranking input."
        ),
    )
)


class HoldingsReason:
    """Named reasons a holdings-derived figure is unavailable."""

    NOT_LOADED: Final = "holdings_not_loaded"
    INSUFFICIENT_MONTHS: Final = "insufficient_holdings_months"
    AS_OF_MISMATCH: Final = "holdings_as_of_months_differ"
    ASSET_TYPE_MISSING: Final = "holdings_asset_type_not_supplied"


REASON_DESCRIPTIONS: Final[dict[str, str]] = {
    HoldingsReason.NOT_LOADED: (
        "No holdings are stored for this scheme. This project ships no holdings data and "
        "fetches none - the candidate source is unreachable and scraping AMC sites is "
        "refused - so a portfolio appears here only once one is imported with "
        "`make holdings-import`."
    ),
    HoldingsReason.INSUFFICIENT_MONTHS: (
        "Turnover is the change between two consecutive monthly portfolios, so it needs at "
        "least two disclosure months for this scheme. Only one is stored."
    ),
    HoldingsReason.AS_OF_MISMATCH: (
        "The two funds' latest portfolios are more than a month apart. Overlapping a January "
        "portfolio with a June one would measure six months of trading as if it were a "
        "difference in holdings, so the pair is refused rather than reported."
    ),
    HoldingsReason.ASSET_TYPE_MISSING: (
        "The imported file carries no asset_type for this scheme-month, so the equity share "
        "of the portfolio is unknown and cannot be cross-checked against the returns-based "
        "exposure estimate."
    ),
}

# Two funds' portfolios are comparable only if they were filed within a month of each
# other. Holdings are monthly, so one month of slack is the whole tolerance there is.
MAX_OVERLAP_MONTH_GAP: Final = 1
# SEBI's equity-oriented threshold, the same 65% line `metrics/tax.py` reads a category
# against. A portfolio above it should be explicable by an all-equity Indian style basis.
EQUITY_ORIENTED_SHARE: Final = 0.65
TOP_N: Final = 10

CROSS_CHECK_NOTE: Final = (
    "Two independent readings of the same fund. Holdings are what the AMC filed for one "
    "month; returns-based exposure is fitted from the whole NAV history and names no "
    "company. Where they disagree, both are shown: the disagreement is itself information "
    "about a fund that has traded since the filing, or one the style basis does not cover."
)


# --------------------------------------------------------------------------- import


def known_scheme_codes(con: Any) -> set[str]:
    return {str(r[0]) for r in con.execute("SELECT scheme_code FROM scheme_master").fetchall()}


def validate_csv(path: Path, settings: Settings | None = None) -> dict[str, Any]:
    """Check a holdings CSV against the contract without writing anything."""
    from ..db import connect, init_schema  # deferred: db.py imports this package at load time

    s = settings or get_settings()
    with connect(s) as con:
        init_schema(con)
        codes = known_scheme_codes(con)
    _, report = read_and_validate(path, codes)
    return report.to_dict()


def import_csv(path: Path, settings: Settings | None = None) -> dict[str, Any]:
    """Validate a holdings CSV and load it.

    Nothing is written unless the whole file passes. Each (scheme_code, as_of) the file
    carries is replaced wholesale rather than merged: a portfolio is a complete list, so
    a re-import that dropped a position must drop it here too instead of leaving last
    month's row behind at its old weight.
    """
    from ..db import connect, init_schema

    s = settings or get_settings()
    now = datetime.now(UTC).replace(tzinfo=None)
    with connect(s) as con:
        init_schema(con)
        df, report = read_and_validate(path, known_scheme_codes(con))
        df = df.assign(
            source=f"csv:{path.name}", source_url=path.resolve().as_uri(), fetched_at=now
        )
        con.register("holdings_in", df)
        con.execute(
            f"DELETE FROM {TABLE.name} WHERE (scheme_code, as_of) IN "
            "(SELECT DISTINCT scheme_code, as_of FROM holdings_in)"
        )
        con.execute(
            f"INSERT INTO {TABLE.name} (scheme_code, instrument_key, instrument_id, "
            "instrument_name, weight, quantity, market_value, sector, asset_type, "
            "source, source_url, fetched_at, as_of) "
            "SELECT scheme_code, instrument_key, instrument_id, instrument_name, weight, "
            "quantity, market_value, sector, asset_type, source, source_url, fetched_at, as_of "
            "FROM holdings_in"
        )
        con.unregister("holdings_in")
    return {
        **report.to_dict(),
        "rows_written": len(df),
        "scheme_months_written": len(report.scheme_months),
    }


# --------------------------------------------------------------------------- derived


def concentration(holdings: pd.DataFrame, top_n: int = TOP_N) -> dict[str, Any]:
    """Holding count, total disclosed weight and the top-N share of one portfolio."""
    weights = holdings["weight"]
    return {
        "holdings_count": len(holdings),
        "weight_sum": round(float(weights.sum()), 6),
        f"top_{top_n}_concentration": round(float(weights.nlargest(top_n).sum()), 6),
    }


def _allocation(holdings: pd.DataFrame, column: str) -> list[dict[str, Any]]:
    """Weight by `column`, heaviest first, with an explicit unclassified bucket.

    An unclassified bucket rather than a dropped row: a sector split that quietly sums
    to 0.6 reads as a fund holding 40% cash.
    """
    grouped = holdings.groupby(column, dropna=False)["weight"].sum()
    rows = [
        {column: None if pd.isna(name) else str(name), "weight": round(float(value), 6)}
        for name, value in grouped.items()
    ]
    return sorted(rows, key=lambda r: -r["weight"])


def sector_allocation(holdings: pd.DataFrame) -> list[dict[str, Any]]:
    return _allocation(holdings, "sector")


def asset_type_split(holdings: pd.DataFrame) -> list[dict[str, Any]]:
    return _allocation(holdings, "asset_type")


def equity_share(holdings: pd.DataFrame) -> float | None:
    """Fraction of net assets in equity, or None when the file carried no asset_type."""
    if holdings.empty or holdings["asset_type"].isna().all():
        return None
    return round(float(holdings.loc[holdings["asset_type"] == "equity", "weight"].sum()), 6)


def exposure_cross_check(holdings: pd.DataFrame, style_fit_explains: bool) -> dict[str, Any]:
    """Whether the filed portfolio and the returns-based fit tell the same story.

    The style basis is built entirely from Indian equity index proxies, so it explains
    an equity-oriented fund and refuses a fund that is mostly debt, cash or offshore.
    A portfolio over the 65% equity line that the basis cannot explain, or one under it
    that the basis explains well, is a genuine disagreement between the two readings -
    flagged, with both sides kept, rather than resolved by preferring one.
    """
    share = equity_share(holdings)
    if share is None:
        return {
            "holdings_equity_share": None,
            "style_basis_explains_this_fund": style_fit_explains,
            "diverges": None,
            "reason": HoldingsReason.ASSET_TYPE_MISSING,
            "note": CROSS_CHECK_NOTE,
        }
    return {
        "holdings_equity_share": share,
        "style_basis_explains_this_fund": style_fit_explains,
        "diverges": (share >= EQUITY_ORIENTED_SHARE) != style_fit_explains,
        "reason": None,
        "note": CROSS_CHECK_NOTE,
    }


@dataclass(frozen=True, slots=True)
class TurnoverPoint:
    from_as_of: date
    to_as_of: date
    turnover: float

    def to_dict(self) -> dict[str, Any]:
        return {
            "from_as_of": self.from_as_of.isoformat(),
            "to_as_of": self.to_as_of.isoformat(),
            "turnover": round(self.turnover, 6),
        }


def _weights_by_instrument(holdings: pd.DataFrame) -> dict[str, float]:
    return {
        str(key): float(value)
        for key, value in holdings.groupby("instrument_key")["weight"].sum().items()
    }


def _turnover(before: dict[str, float], after: dict[str, float]) -> float:
    """Half the sum of absolute weight changes - the same convention as `style_drift`,
    so 0 is an unchanged portfolio and 1 a complete replacement."""
    names = set(before) | set(after)
    return sum(abs(after.get(n, 0.0) - before.get(n, 0.0)) for n in names) / 2.0


def turnover_series(holdings: pd.DataFrame) -> tuple[list[TurnoverPoint], str | None]:
    """Turnover between each consecutive pair of disclosure months, and why there is none.

    Consecutive as filed, not as dated: a gap in the disclosures is diffed across rather
    than treated as no change, and the point's own two dates say how far apart it is.
    """
    months = sorted(holdings["as_of"].unique())
    if len(months) < 2:
        return [], HoldingsReason.INSUFFICIENT_MONTHS
    by_month = {
        month: _weights_by_instrument(holdings.loc[holdings["as_of"] == month]) for month in months
    }
    return [
        TurnoverPoint(before, after, _turnover(by_month[before], by_month[after]))
        for before, after in pairwise(months)
    ], None


@dataclass(frozen=True, slots=True)
class PairOverlap:
    code_a: str
    code_b: str
    as_of_a: date | None
    as_of_b: date | None
    overlap_pct: float | None
    shared: list[dict[str, Any]]
    reason: str | None

    def to_dict(self) -> dict[str, Any]:
        return {
            "scheme_code_a": self.code_a,
            "scheme_code_b": self.code_b,
            "as_of_a": None if self.as_of_a is None else self.as_of_a.isoformat(),
            "as_of_b": None if self.as_of_b is None else self.as_of_b.isoformat(),
            "overlap_pct": self.overlap_pct,
            "shared_instruments": self.shared,
            "reason": self.reason,
        }


def _months_apart(a: date, b: date) -> int:
    return abs((a.year - b.year) * 12 + (a.month - b.month))


def overlap_pair(code_a: str, a: pd.DataFrame, code_b: str, b: pd.DataFrame) -> PairOverlap:
    """Sum of the minimum weight per instrument both funds hold, as a percentage.

    Two funds holding the same portfolio overlap 100%; two holding nothing in common
    overlap 0%. Refused outright when the two portfolios are more than a month apart,
    because the difference would then be trading rather than positioning.
    """
    as_of_a = None if a.empty else max(a["as_of"])
    as_of_b = None if b.empty else max(b["as_of"])
    if as_of_a is None or as_of_b is None:
        return PairOverlap(code_a, code_b, as_of_a, as_of_b, None, [], HoldingsReason.NOT_LOADED)
    if _months_apart(as_of_a, as_of_b) > MAX_OVERLAP_MONTH_GAP:
        return PairOverlap(
            code_a, code_b, as_of_a, as_of_b, None, [], HoldingsReason.AS_OF_MISMATCH
        )

    latest_a = a.loc[a["as_of"] == as_of_a]
    latest_b = b.loc[b["as_of"] == as_of_b]
    weights_a = _weights_by_instrument(latest_a)
    weights_b = _weights_by_instrument(latest_b)
    names = dict(zip(latest_a["instrument_key"], latest_a["instrument_name"], strict=True))
    names.update(zip(latest_b["instrument_key"], latest_b["instrument_name"], strict=True))

    shared = [
        {
            "instrument_key": key,
            "instrument_name": names[key],
            "weight_a": round(weights_a[key], 6),
            "weight_b": round(weights_b[key], 6),
            "min_weight": round(min(weights_a[key], weights_b[key]), 6),
        }
        for key in weights_a.keys() & weights_b.keys()
    ]
    shared.sort(key=lambda row: -float(row["min_weight"]))
    overlap = sum(float(row["min_weight"]) for row in shared)
    return PairOverlap(code_a, code_b, as_of_a, as_of_b, round(overlap * 100.0, 4), shared, None)


def overlap_report(frames: dict[str, pd.DataFrame]) -> list[dict[str, Any]]:
    """Every unordered pair of the given funds, in the order the codes were supplied."""
    codes = list(frames)
    return [overlap_pair(a, frames[a], b, frames[b]).to_dict() for a, b in combinations(codes, 2)]


# --------------------------------------------------------------------------- dormant source


def _fetch_raw(scheme_code: str, settings: Settings) -> list[dict[str, Any]] | None:
    """None on a 404 (the source answered: it does not carry this scheme); anything else
    that goes wrong raises, for `fetch_or_reason` to name as `SOURCE_UNREACHABLE`."""
    url = f"{settings.mf_holdings_source_url.rstrip('/')}/schemes/{scheme_code}/holdings"
    with client(settings) as http:
        response = http.get(url)
    if response.status_code == 404:
        return None
    response.raise_for_status()
    payload = response.json()
    return list(payload.get("holdings", payload)) if isinstance(payload, dict) else list(payload)


def fetch_scheme_holdings(
    scheme_code: str, settings: Settings | None = None
) -> tuple[list[dict[str, Any]] | None, str | None]:
    """Dormant adapter for the candidate source. **Nothing calls this.**

    No pipeline, make target or scheduled job reaches it, and none may: the source
    returned HTTP 522 on every probe on 2026-09-09 and again on 2026-09-12, and the
    policy in `docs/data-policy.md` refuses the alternatives. It exists so that the day
    the source is reliably available, wiring it up is one call rather than a rewrite -
    and until then, calling it produces `enrichment_source_unreachable`, never an
    exception reaching a page.
    """
    s = enrich_http_settings(settings or get_settings())
    raw, reason = fetch_or_reason(lambda: _fetch_raw(scheme_code, s))
    if reason is not None:
        return None, reason
    if raw is None:
        return None, EnrichReason.NOT_CARRIED
    return raw, None


__all__ = [
    "CROSS_CHECK_NOTE",
    "MAX_OVERLAP_MONTH_GAP",
    "TABLE",
    "TOP_N",
    "HoldingsCsvError",
    "HoldingsReason",
    "PairOverlap",
    "TurnoverPoint",
    "asset_type_split",
    "concentration",
    "equity_share",
    "exposure_cross_check",
    "fetch_scheme_holdings",
    "import_csv",
    "overlap_pair",
    "overlap_report",
    "sector_allocation",
    "turnover_series",
    "validate_csv",
]
