"""Reasons a metric is unavailable. Every null in the app carries one of these."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Final

import duckdb

from .enrich import REGISTRY as ENRICH_REGISTRY


class Reason:
    INSUFFICIENT_HISTORY: Final = "insufficient_history"
    INSUFFICIENT_OBSERVATIONS: Final = "insufficient_observations"
    INSUFFICIENT_WINDOWS: Final = "insufficient_rolling_windows"
    INSUFFICIENT_PEERS: Final = "insufficient_peer_universe"
    BENCHMARK_UNAVAILABLE: Final = "benchmark_unavailable"
    BENCHMARK_UNMAPPED: Final = "benchmark_not_mapped"
    BENCHMARK_CURRENCY: Final = "benchmark_currency_mismatch"
    NO_OVERLAP: Final = "no_overlapping_observations"
    ZERO_DENOMINATOR: Final = "zero_or_invalid_denominator"
    SIGN_CHANGING_DENOMINATOR: Final = "denominator_zero_or_negative"
    OUT_OF_TOLERANCE: Final = "start_observation_outside_tolerance"
    NO_DOWNSIDE: Final = "no_downside_observations"
    SOURCE_FIELD_MISSING: Final = "source_field_missing"
    NAV_GAP: Final = "nav_gap_in_window"
    NAV_DISCONTINUITY: Final = "nav_scale_discontinuity"
    TER_NOT_PUBLISHED: Final = "ter_not_published"
    # Why a scheme has no metrics row at all, as opposed to one null metric.
    ALL_NAVS_NON_POSITIVE: Final = "all_navs_non_positive"
    NO_NAV_HISTORY: Final = "no_nav_history"
    TOO_FEW_MONTH_ENDS: Final = "too_few_month_end_observations"
    SNAPSHOT_STALE: Final = "snapshot_predates_this_nav_history"
    STYLE_FIT_TOO_WEAK: Final = "style_basis_does_not_describe_this_fund"


DESCRIPTIONS: Final[dict[str, str]] = {
    Reason.INSUFFICIENT_HISTORY: "The scheme does not have enough NAV history for this horizon.",
    Reason.INSUFFICIENT_OBSERVATIONS: "Fewer monthly observations than the metric requires.",
    Reason.INSUFFICIENT_WINDOWS: "Fewer valid rolling windows than the configured minimum.",
    Reason.INSUFFICIENT_PEERS: "Too few eligible peer schemes in the sub-category for this horizon.",
    Reason.BENCHMARK_UNAVAILABLE: "No benchmark index data loaded for the mapped benchmark and period.",
    Reason.BENCHMARK_UNMAPPED: (
        "No benchmark is mapped to this scheme: none is configured for the index or "
        "sub-category it follows, or the only candidate is an index-fund proxy built from "
        "this same fund, which would measure the fund against itself."
    ),
    Reason.BENCHMARK_CURRENCY: (
        "The mapped benchmark is denominated in a different currency from the fund's NAV. "
        "Comparing them would measure the exchange rate as well as performance, so this "
        "metric is withheld until an INR-converted series is imported."
    ),
    Reason.STYLE_FIT_TOO_WEAK: (
        "The style-factor basis explains too little of this fund's month-to-month movement "
        "for the fitted weights to mean anything. That is the honest answer for a fund the "
        "basis does not cover, such as one investing outside India, or in gold or debt."
    ),
    Reason.TER_NOT_PUBLISHED: (
        "No usable expense ratio for this scheme. The TER source is a daily scrape of "
        "AMFI's per-AMC disclosures, covers only part of the industry, and is matched by "
        "name, so a value is never inferred from a similar one. A fund is also withheld "
        "when its disclosure contradicts itself, such as a Direct plan priced above the "
        "Regular plan it cannot cost more than."
    ),
    Reason.ALL_NAVS_NON_POSITIVE: (
        "Every NAV published for this scheme was zero or negative. AMFI files 0.00 as a "
        "matured scheme's terminal marker rather than as a price, so none of them can be "
        "used in a return and no metric can be computed. Rebuilding will not change this."
    ),
    Reason.NO_NAV_HISTORY: (
        "The source carries this scheme in its master list but publishes no NAV history "
        "for it, so there is nothing to compute a return from."
    ),
    Reason.TOO_FEW_MONTH_ENDS: (
        "Fewer than two month-end NAV observations survive, so not even a single monthly "
        "return can be formed. A scheme that only ever traded inside one month lands here."
    ),
    Reason.SNAPSHOT_STALE: (
        "NAV history is stored for this scheme but the metrics snapshot was built before "
        "it arrived. Run `make metrics` to include it."
    ),
    Reason.NO_OVERLAP: "Fund and comparison series have too few overlapping months.",
    Reason.ZERO_DENOMINATOR: "The metric's denominator is zero, so the ratio is undefined.",
    Reason.SIGN_CHANGING_DENOMINATOR: (
        "The peer/benchmark return used as denominator is zero or negative, "
        "so a ratio would be misleading. The percentage-point excess is shown instead."
    ),
    Reason.OUT_OF_TOLERANCE: "No NAV observation close enough to the required start month-end.",
    Reason.NO_DOWNSIDE: "Not enough observations below the threshold to estimate downside deviation.",
    Reason.SOURCE_FIELD_MISSING: "The data source does not publish this field.",
    Reason.NAV_GAP: "The NAV series has missing months inside the window.",
    Reason.NAV_DISCONTINUITY: (
        "The NAV series changes scale part-way through - a face-value redenomination or "
        "unit split filed as a raw NAV jump. Only the history after the break is comparable, "
        "and it is too short for this window."
    ),
}


@dataclass(frozen=True, slots=True)
class Metric:
    """A metric value plus why it is missing and how much data backed it."""

    value: float | None = None
    n_obs: int = 0
    reason: str | None = None

    @classmethod
    def missing(cls, reason: str, n_obs: int = 0) -> Metric:
        return cls(None, n_obs, reason)

    def __bool__(self) -> bool:
        return self.value is not None


def enrichment_coverage_and_staleness(
    con: duckdb.DuckDBPyConnection, universe_size: int
) -> list[dict[str, Any]]:
    """Per-table enrichment coverage and staleness, for `make validate` to report
    alongside the NAV/metrics checks this module already describes."""
    return ENRICH_REGISTRY.coverage_and_staleness(con, universe_size)


# The modules that keep a reason of their own, rather than adding it to `Reason` above.
# Kept as names resolved at call time because every one of them imports this module.
_LOCAL_REASON_MODULES: Final[tuple[str, ...]] = (
    "mf_analytics.metrics.cashflow",
    "mf_analytics.metrics.tax",
    "mf_analytics.pipeline",
    "mf_analytics.scoring",
    "mf_analytics.enrich.attributes",
    "mf_analytics.enrich.holdings",
)


def all_reason_descriptions() -> dict[str, str]:
    """Every reason a null in this app can carry, shared and module-local alike.

    Composing this by hand at each call site produced merges that each held what the
    other lacked, so a reason resolved to a sentence in one endpoint and to its raw
    snake_case name in the next.
    """
    from importlib import import_module

    merged = dict(DESCRIPTIONS)
    for name in _LOCAL_REASON_MODULES:
        merged.update(getattr(import_module(name), "REASON_DESCRIPTIONS", {}))
    return merged
