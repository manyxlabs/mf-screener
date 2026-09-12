"""Read-only DuckDB access for the API, plus the joined screening relation."""

from __future__ import annotations

import threading
from collections.abc import Iterator
from contextlib import contextmanager
from typing import Any

import duckdb
import pandas as pd

from mf_analytics.config import Settings, get_settings
from mf_analytics.db import StoreLockedError, init_schema
from mf_analytics.ingest.nav import register_nav_view

_LOCK = threading.Lock()
_CONNECTION: duckdb.DuckDBPyConnection | None = None

# The TER and scheme_attributes joins are both LEFT: their sources cover only part of
# the universe, and a fund with no published expense ratio or attributes must still
# screen on everything else. Neither join writes into scheme_metrics_snapshot itself -
# T3.1's fence is about that table, not this read-only view - so the fund's own
# metrics stay free of enrichment while the grid can still display and sort on it.
# manager_tenure_years is derived here, at query time, rather than stored, so it never
# goes stale between refreshes.
SCREEN_VIEW_SQL = """
CREATE OR REPLACE VIEW screen_base AS
SELECT m.*, s.* EXCLUDE (scheme_code, missing_reasons),
       t.expense_ratio,
       a.riskometer, a.exit_load_pct, a.exit_load_period_days, a.lock_in_days,
       a.min_investment, a.min_sip, a.benchmark_name, a.fund_manager,
       date_diff('day', a.manager_start_date, current_date) / 365.25 AS manager_tenure_years,
       CASE WHEN t.expense_ratio IS NULL
            THEN json_merge_patch(s.missing_reasons,
                                  '{"expense_ratio": "ter_not_published"}')::VARCHAR
            ELSE s.missing_reasons END AS missing_reasons
FROM scheme_master m
JOIN scheme_metrics_snapshot s
  ON s.scheme_code = m.scheme_code
 AND s.as_of_date = (SELECT max(as_of_date) FROM scheme_metrics_snapshot)
LEFT JOIN scheme_ter t ON t.scheme_code = m.scheme_code
LEFT JOIN scheme_attributes a ON a.scheme_code = m.scheme_code
"""


def open_connection(settings: Settings | None = None) -> duckdb.DuckDBPyConnection:
    """One shared read-only connection.

    DuckDB allows a single writer per database file, so a read-write API would lock
    the store against `make data-refresh` for as long as it runs. The schema and the
    derived views are created in a short write connection first, then the server
    holds a read-only one; ingestion commands stay free to write concurrently.
    """
    global _CONNECTION
    with _LOCK:
        if _CONNECTION is None:
            s = settings or get_settings()
            s.ensure_dirs()
            # A rebuild holds DuckDB's file lock exclusively, which blocks a read-only
            # connection too, so there is nothing to serve until it finishes. Saying that
            # beats letting the driver's lock message escape as a 500.
            try:
                with duckdb.connect(str(s.mf_duckdb_path)) as bootstrap:
                    init_schema(bootstrap)
                    register_nav_view(bootstrap, s)
                    bootstrap.execute(SCREEN_VIEW_SQL)
                _CONNECTION = duckdb.connect(str(s.mf_duckdb_path), read_only=True)
                # Extensions are per-connection; the fts macros built on the bootstrap
                # connection need loading again here for match_bm25 to resolve.
                _CONNECTION.execute("LOAD fts")
            except duckdb.IOException as exc:
                raise StoreLockedError(
                    "The local data store is being rebuilt by another process "
                    "(make metrics, data-nav or data-refresh). It is locked for writing, "
                    "which DuckDB also blocks reads behind. Retry once that finishes."
                ) from exc
        return _CONNECTION


def close_connection() -> None:
    global _CONNECTION
    with _LOCK:
        if _CONNECTION is not None:
            _CONNECTION.close()
            _CONNECTION = None


@contextmanager
def cursor(settings: Settings | None = None) -> Iterator[duckdb.DuckDBPyConnection]:
    con = open_connection(settings)
    with _LOCK:
        yield con


def query_df(sql: str, params: list[Any] | None = None) -> pd.DataFrame:
    with cursor() as con:
        return con.execute(sql, params or []).fetch_df()


def query_optional(sql: str, params: list[Any] | None = None) -> Any:
    """First column of the first row, or None when the query matched nothing.

    `query_scalar` is for aggregates, which always return a row. A lookup that may
    legitimately match nothing - a scheme with no expense ratio, or none of its own
    metrics yet - belongs here rather than behind that function's exception.
    """
    with cursor() as con:
        row = con.execute(sql, params or []).fetchone()
    return None if row is None else row[0]


def query_scalar(sql: str, params: list[Any] | None = None) -> Any:
    """First column of the first row; an aggregate query always has one."""
    with cursor() as con:
        row = con.execute(sql, params or []).fetchone()
    if row is None:
        raise RuntimeError(f"Query returned no rows: {sql}")
    return row[0]
