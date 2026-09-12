"""The enrichment contract, built before any enrichment source exists.

Everything an enrichment source carries (holdings, riskometer, exit load, fund
manager, and so on) is third-party data this project does not compute and cannot
verify. This package is the fence around it: an enrichment table always carries
`source`, `source_url`, `fetched_at` and `as_of`; its columns are registered here,
never in `db.py`, and `assert_disjoint_from_snapshot` fails loudly if one of them
ever reaches `scheme_metrics_snapshot`, a ranking, or a risk computation.

A future task (T3.2, T3.3) adds a source by building an `EnrichmentTable` and calling
`REGISTRY.register(...)` - not by declaring its own `CREATE TABLE` in `db.py`.
"""

from __future__ import annotations

from collections.abc import Callable, Iterable
from dataclasses import dataclass
from datetime import date, timedelta
from typing import Any, Final

import httpx

from ..config import Settings, get_settings
from ..http_client import DownloadError

# Every enrichment row must carry all four or not exist. Declared once so no table
# definition can leave one out, and NOT NULL so a partial row cannot be inserted.
PROVENANCE_COLUMNS: Final[dict[str, str]] = {
    "source": "VARCHAR NOT NULL",
    "source_url": "VARCHAR NOT NULL",
    "fetched_at": "TIMESTAMP NOT NULL",
    "as_of": "DATE NOT NULL",
}


class EnrichReason:
    """Named reasons for an enrichment null.

    Kept separate from `quality.Reason`: those describe a computation over NAV that
    ran and fell short of a threshold, these describe a third-party fetch that never
    produced a trustworthy value at all.
    """

    SOURCE_UNREACHABLE: Final = "enrichment_source_unreachable"
    NOT_CARRIED: Final = "enrichment_source_does_not_carry_this_fund"
    STALE: Final = "enrichment_value_stale"


@dataclass(frozen=True, slots=True)
class Enriched:
    """An enrichment value plus why it is missing or stale.

    Not `quality.Metric`: that dataclass carries an observation count for a computed
    metric, which an enrichment field (a benchmark name, a manager, a riskometer
    label) does not have.
    """

    value: Any | None = None
    as_of: date | None = None
    reason: str | None = None
    stale: bool = False

    @classmethod
    def missing(cls, reason: str) -> Enriched:
        return cls(None, None, reason, False)

    def __bool__(self) -> bool:
        return self.value is not None


@dataclass(frozen=True)
class EnrichmentTable:
    """One enrichment table's domain columns. Provenance and the primary key are
    added by `create_sql`, never listed here."""

    name: str
    columns: dict[str, str]
    key_columns: tuple[str, ...]
    description: str

    def __post_init__(self) -> None:
        overlap = set(self.columns) & set(PROVENANCE_COLUMNS)
        if overlap:
            raise ValueError(f"{self.name}: {overlap} collide with mandatory provenance columns")
        if not self.key_columns:
            raise ValueError(f"{self.name}: key_columns must be non-empty")

    def create_sql(self) -> str:
        all_columns = {**self.columns, **PROVENANCE_COLUMNS}
        body = ",\n    ".join(f"{n} {k}" for n, k in all_columns.items())
        keys = ", ".join(self.key_columns)
        return (
            f"-- {self.description}\n"
            f"CREATE TABLE IF NOT EXISTS {self.name} (\n    {body},\n"
            f"    PRIMARY KEY ({keys})\n);"
        )

    def domain_column_names(self) -> set[str]:
        """Columns that could plausibly leak into a snapshot, ranking or risk metric.

        Excludes provenance (`source`, `source_url`, `fetched_at`, `as_of` -
        bookkeeping, not fund data) and the key columns (`scheme_code` and similar
        join keys are expected to also exist on the snapshot; that is how a caller
        joins enrichment onto it, not a leak of enrichment data into it).
        """
        return set(self.columns) - set(self.key_columns)


class EnrichmentRegistry:
    """Where enrichment tables live, so a source can be added without touching the
    agents who own `db.py`'s schema. `db.py` calls `REGISTRY.init_schema(con)`;
    `quality.py` calls `REGISTRY.coverage_and_staleness(con, universe_size)`.
    """

    def __init__(self) -> None:
        self._tables: dict[str, EnrichmentTable] = {}

    def register(self, table: EnrichmentTable) -> EnrichmentTable:
        if table.name in self._tables:
            raise ValueError(f"enrichment table {table.name!r} already registered")
        self._tables[table.name] = table
        return table

    def tables(self) -> tuple[EnrichmentTable, ...]:
        return tuple(self._tables.values())

    def init_schema(self, con: Any) -> None:
        for table in self._tables.values():
            con.execute(table.create_sql())

    def column_names(self) -> set[str]:
        names: set[str] = set()
        for table in self._tables.values():
            names |= table.domain_column_names()
        return names

    def coverage_and_staleness(
        self, con: Any, universe_size: int, settings: Settings | None = None
    ) -> list[dict[str, Any]]:
        """One row per registered table: how much of the universe it covers and how
        much of that has fallen past the staleness threshold. Empty until T3.2/T3.3
        register a table - `make validate` then has nothing enrichment-related to
        report, which is the correct answer before any source exists.
        """
        s = settings or get_settings()
        cutoff = date.today() - timedelta(days=s.mf_enrich_stale_days)
        report = []
        for table in self._tables.values():
            rows, stale_rows, latest_as_of = con.execute(
                f"SELECT count(*), count(*) FILTER (WHERE as_of < ?), max(as_of) FROM {table.name}",
                [cutoff],
            ).fetchone()
            coverage_pct = round(rows / universe_size * 100.0, 1) if universe_size else 0.0
            report.append(
                {
                    "table": table.name,
                    "rows": rows,
                    "coverage_pct": coverage_pct,
                    "stale_rows": stale_rows,
                    "latest_as_of": latest_as_of,
                    "stale_threshold_days": s.mf_enrich_stale_days,
                }
            )
        return report


# One process-wide registry. T3.2 and T3.3 import this and call `.register(...)` at
# module load time, the same way `db.py`'s own tables are declared once at import.
REGISTRY = EnrichmentRegistry()


def assert_disjoint_from_snapshot(snapshot_columns: Iterable[str]) -> None:
    """The fence: fails loudly if an enrichment column ever reaches the snapshot,
    a ranking, or a risk computation. `db.py` calls this once, right after it builds
    its own snapshot column list, so the check runs on every process start."""
    overlap = REGISTRY.column_names() & set(snapshot_columns)
    if overlap:
        raise AssertionError(
            "enrichment columns must never enter scheme_metrics_snapshot, a ranking, "
            f"or a risk computation, found: {sorted(overlap)}"
        )


def is_stale(as_of: date, settings: Settings | None = None) -> bool:
    s = settings or get_settings()
    return (date.today() - as_of).days > s.mf_enrich_stale_days


def enrich_http_settings(settings: Settings | None = None) -> Settings:
    """A `Settings` copy carrying the enrichment source's own timeout, retries and
    backoff, so a slow or flaky third-party source cannot borrow the NAV provider's
    limits and cannot make a NAV ingest wait on it."""
    s = settings or get_settings()
    return s.model_copy(
        update={
            "mf_http_timeout": s.mf_enrich_http_timeout,
            "mf_http_retries": s.mf_enrich_http_retries,
            "mf_http_backoff": s.mf_enrich_http_backoff,
        }
    )


def fetch_or_reason[T](fetch: Callable[[], T]) -> tuple[T | None, str | None]:
    """Runs an enrichment fetch, turning any failure into a named reason instead of
    letting it propagate, so a dependent page renders with an explained blank rather
    than an error page or a stale value presented as current."""
    try:
        return fetch(), None
    except (httpx.HTTPError, DownloadError):
        # DownloadError is `http_client.request_json`'s own "retries exhausted"
        # signal - a source that fails every retry is exactly as unreachable as one
        # that raises immediately.
        return None, EnrichReason.SOURCE_UNREACHABLE


# T3.2 (and later T3.3) register their tables by importing here, at the end of this
# module, once everything above they depend on already exists on this package.
from . import attributes as _attributes  # noqa: E402,F401
