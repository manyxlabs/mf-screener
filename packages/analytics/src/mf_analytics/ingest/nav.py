"""NAV ingestion: raw bulk file -> canonical year-partitioned parquet -> DuckDB view.

The full history is 37M rows. Nothing here loads it into pandas: DuckDB scans the
source parquet, normalises it and writes the partitioned lake in one streaming
statement, spilling to disk rather than to RAM.
"""

from __future__ import annotations

import shutil
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import duckdb
import pandas as pd

from ..config import Settings, get_settings
from ..db import (
    connect,
    init_schema,
    raw_file_sha256,
    record_ingest,
    record_raw_file,
    scalar,
    write_sidecar,
)
from ..logging_setup import get_logger, log_event
from ..sources.tigzig import TigZigSource

logger = get_logger(__name__)

# Every row entering the lake goes through this. Callers supply a relation of
# (scheme_code, date, nav, priority); `priority` breaks ties when the same scheme+date
# arrives from two places, so a fresh top-up wins over the copy already on disk.
NORMALISE_SQL = """
SELECT CAST(scheme_code AS VARCHAR)          AS scheme_code,
       TRY_CAST(date AS DATE)                AS date,
       TRY_CAST(nav AS DOUBLE)               AS nav,
       CAST(? AS VARCHAR)                    AS source,
       CAST(? AS TIMESTAMP)                  AS ingested_at,
       year(TRY_CAST(date AS DATE))          AS year
FROM ({source_relation})
WHERE TRY_CAST(date AS DATE) IS NOT NULL
  -- a NAV of 0.00 on a matured scheme is AMFI's terminal marker, not a price
  AND TRY_CAST(nav AS DOUBLE) > 0
QUALIFY row_number() OVER (
    PARTITION BY CAST(scheme_code AS VARCHAR), TRY_CAST(date AS DATE)
    ORDER BY priority DESC, TRY_CAST(nav AS DOUBLE)
) = 1
"""


def nav_dataset_dir(settings: Settings) -> Path:
    return settings.processed_dir / "nav_daily"


def nav_glob(settings: Settings) -> str:
    return str(nav_dataset_dir(settings) / "**" / "*.parquet")


def tune_for_bulk(con: duckdb.DuckDBPyConnection, settings: Settings) -> None:
    """Let DuckDB spill to the data lake instead of failing on a 37M-row window sort."""
    spill = settings.cache_dir / "duckdb-spill"
    spill.mkdir(parents=True, exist_ok=True)
    con.execute(f"SET temp_directory = '{spill}'")
    con.execute(f"SET memory_limit = '{settings.mf_duckdb_memory_limit}'")
    # Ordering across partition files carries no meaning and costs memory to preserve.
    con.execute("SET preserve_insertion_order = false")
    if settings.mf_duckdb_threads:
        con.execute(f"SET threads = {settings.mf_duckdb_threads}")


def _drop_nav_relation(con: duckdb.DuckDBPyConnection) -> None:
    row = con.execute(
        "SELECT table_type FROM information_schema.tables WHERE table_name = 'nav_daily'"
    ).fetchone()
    if row:
        con.execute(f"DROP {'VIEW' if row[0] == 'VIEW' else 'TABLE'} nav_daily")


def register_nav_view(con: duckdb.DuckDBPyConnection, settings: Settings) -> None:
    """nav_daily is a view over the parquet lake: 37M rows never enter the DB file.

    Before the first ingest there is no lake, so an empty table stands in and every
    downstream query still runs (and returns nothing) instead of failing on a missing
    relation.
    """
    _drop_nav_relation(con)
    if not any(nav_dataset_dir(settings).glob("**/*.parquet")):
        con.execute(
            "CREATE TABLE nav_daily (scheme_code VARCHAR, date DATE, nav DOUBLE, "
            "source VARCHAR, ingested_at TIMESTAMP)"
        )
        return
    con.execute(
        "CREATE VIEW nav_daily AS SELECT scheme_code, date, nav, source, ingested_at "
        f"FROM read_parquet('{nav_glob(settings)}', hive_partitioning = 1)"
    )


def _promote(staging: Path, lake: Path, replace_all: bool) -> list[int]:
    """Move freshly written year partitions over the live ones.

    Writing to staging first means readers never see a half-written lake, and it is
    what makes a partial rewrite possible at all: DuckDB's PARTITION_BY OVERWRITE
    clears the whole output directory, not just the partitions it is about to write.
    """
    written = sorted(p for p in staging.glob("year=*") if p.is_dir())
    if not written:
        raise RuntimeError(
            "Refusing to promote an empty NAV write - the source produced no rows. "
            "The existing lake is untouched; check the download and re-run."
        )
    lake.mkdir(parents=True, exist_ok=True)
    if replace_all:
        for stale in lake.glob("year=*"):
            if stale.is_dir() and stale.name not in {p.name for p in written}:
                shutil.rmtree(stale)
    for part in written:
        target = lake / part.name
        shutil.rmtree(target, ignore_errors=True)
        part.rename(target)
    shutil.rmtree(staging, ignore_errors=True)
    return sorted(int(p.name.split("=")[1]) for p in written)


def _record_zero_navs(
    con: duckdb.DuckDBPyConnection,
    select_sql: str,
    params: list[Any] | None,
    recorded: datetime,
) -> None:
    """Note which schemes the `nav > 0` filter dropped rows for, before they are gone.

    Only schemes that actually have such rows are written, so an incremental top-up
    adds newly matured schemes without erasing what a full ingest already found.
    """
    con.execute(
        f"""
        INSERT OR REPLACE INTO nav_zero_excluded
        SELECT CAST(scheme_code AS VARCHAR), count(*), max(TRY_CAST(date AS DATE)),
               CAST(? AS TIMESTAMP)
        FROM ({select_sql})
        WHERE TRY_CAST(nav AS DOUBLE) <= 0 AND TRY_CAST(date AS DATE) IS NOT NULL
        GROUP BY 1
        """,
        [recorded, *(params or [])],
    )


def write_nav_dataset(
    con: duckdb.DuckDBPyConnection,
    select_sql: str,
    settings: Settings,
    params: list[Any] | None = None,
    replace_all: bool = True,
) -> int:
    """Stream a NAV relation into the canonical partitioned dataset.

    `select_sql` must yield scheme_code, date, nav and priority. With
    `replace_all=False` only the year partitions the relation actually produces are
    replaced, which is what keeps an incremental top-up from rewriting 37M rows.
    """
    lake = nav_dataset_dir(settings)
    staging = lake.with_name(lake.name + ".staging")
    shutil.rmtree(staging, ignore_errors=True)
    ingested = datetime.now(UTC).replace(tzinfo=None)
    con.execute(
        f"COPY ({NORMALISE_SQL.format(source_relation=select_sql)}) TO '{staging}' "
        "(FORMAT PARQUET, PARTITION_BY (year), OVERWRITE 1, COMPRESSION zstd)",
        ["tigzig", ingested, *(params or [])],
    )
    _record_zero_navs(con, select_sql, params, ingested)
    years = _promote(staging, lake, replace_all)
    register_nav_view(con, settings)
    rows = int(scalar(con, "SELECT count(*) FROM nav_daily"))
    log_event(logger, "nav.written", years=len(years), rows=rows, replace_all=replace_all)
    return rows


def refresh_monthly_tables(
    con: duckdb.DuckDBPyConnection, tolerance_days: int | None = None
) -> tuple[int, int]:
    """Month-end NAV grid and monthly returns, derived entirely in SQL from nav_daily.

    A month whose last NAV lands more than `tolerance_days` before the month end is
    not a month-end observation: it is dropped, which also excludes the running
    current month. It reappears as a gap on the reindexed grid, never as a value.
    """
    tol = (
        tolerance_days if tolerance_days is not None else get_settings().mf_month_end_tolerance_days
    )
    created = datetime.now(UTC).replace(tzinfo=None)
    con.execute("DELETE FROM nav_monthly")
    con.execute(
        """
        INSERT INTO nav_monthly
        SELECT scheme_code, last_day(date) AS date, nav, date AS obs_date, CAST(? AS TIMESTAMP)
        FROM (
            SELECT scheme_code, date, nav,
                   row_number() OVER (PARTITION BY scheme_code, date_trunc('month', date)
                                      ORDER BY date DESC) AS rn
            FROM nav_daily
        )
        WHERE rn = 1 AND date_diff('day', date, last_day(date)) <= ?
        """,
        [created, tol],
    )
    con.execute("DELETE FROM monthly_returns")
    con.execute(
        """
        INSERT INTO monthly_returns
        SELECT scheme_code, date,
               nav / prev_nav - 1                AS monthly_return,
               ln(nav / prev_nav)                AS log_return
        FROM (
            SELECT scheme_code, date, nav,
                   lag(nav) OVER (PARTITION BY scheme_code ORDER BY date) AS prev_nav,
                   lag(date) OVER (PARTITION BY scheme_code ORDER BY date) AS prev_date
            FROM nav_monthly
        )
        -- consecutive calendar months only: a gap must stay a gap, never be bridged
        WHERE prev_nav IS NOT NULL AND prev_nav > 0
          AND date_diff('month', prev_date, date) = 1
        """
    )
    n_monthly = int(scalar(con, "SELECT count(*) FROM nav_monthly"))
    n_returns = int(scalar(con, "SELECT count(*) FROM monthly_returns"))
    return n_monthly, n_returns


def _already_ingested(con: duckdb.DuckDBPyConnection, dest: Path, sha256: str | None) -> bool:
    """True when this exact file is already the lake's contents."""
    if not sha256 or raw_file_sha256(con, dest) != sha256:
        return False
    return int(scalar(con, "SELECT count(*) FROM nav_daily")) > 0


def run(
    force: bool = False, settings: Settings | None = None, run_id: str | None = None
) -> dict[str, Any]:
    """Download the provider's full NAV history and rebuild the canonical lake from it."""
    s = settings or get_settings()
    s.ensure_dirs()
    started = datetime.now(UTC).replace(tzinfo=None)
    rid = run_id or started.strftime("%Y%m%dT%H%M%S")
    source = TigZigSource(s)
    dest = s.raw_dir / f"nav_history.{s.mf_nav_format}"

    advertised = source.manifest_file(s.mf_nav_format)
    print(
        f"Full NAV history: {advertised.get('size_human')}, "
        f"{advertised.get('row_count'):,} rows. The download resumes if interrupted."
    )
    meta = source.fetch_nav(dest, force=force)
    schema = source.validate_nav_file(dest)
    meta.update(
        {
            "file_row_count": schema["num_rows"],
            "manifest_row_count": advertised.get("row_count"),
            "row_groups": schema["num_row_groups"],
            "source_columns": schema["columns"],
        }
    )
    if advertised.get("row_count") and schema["num_rows"] != advertised["row_count"]:
        # The provider regenerates these files three times a day; a manifest read either
        # side of a sync legitimately disagrees with the bytes. Worth recording, not fatal.
        log_event(
            logger,
            "nav.row_count_drift",
            file_rows=schema["num_rows"],
            manifest_rows=advertised["row_count"],
        )

    with connect(s) as con:
        init_schema(con)
        register_nav_view(con, s)
        tune_for_bulk(con, s)
        if not force and _already_ingested(con, dest, meta.get("sha256")):
            rows = int(scalar(con, "SELECT count(*) FROM nav_daily"))
            log_event(logger, "nav.already_ingested", rows=rows, sha256=meta.get("sha256"))
            print(f"Lake already built from this exact file ({rows:,} rows). Use --force to redo.")
            return {**meta, "rows": rows, "skipped": True}

        print(f"Normalising {schema['num_rows']:,} rows into the partitioned lake...")
        rows = write_nav_dataset(
            con,
            f"SELECT scheme_code, date, nav, 0 AS priority FROM read_parquet('{dest}')",
            s,
        )
        n_monthly, n_returns = refresh_monthly_tables(con)
        meta.update(
            {
                "rows": rows,
                "ingested_rows": rows,
                "dropped_rows": schema["num_rows"] - rows,
                "nav_monthly_rows": n_monthly,
                "monthly_return_rows": n_returns,
                "skipped": False,
            }
        )
        record_raw_file(con, dest, "nav_history", source.name, meta)
        record_ingest(
            con,
            rid,
            "data-nav",
            started,
            "ok",
            source_url=meta.get("url"),
            row_count=rows,
            checksum=meta.get("sha256"),
            details=meta,
        )
    write_sidecar(dest.with_suffix(dest.suffix + ".meta.json"), meta)
    log_event(logger, "nav.loaded", rows=rows, monthly=n_monthly, returns=n_returns)
    return meta


def refresh_recent(
    days: int = 45, settings: Settings | None = None, run_id: str | None = None
) -> dict[str, Any]:
    """Incremental top-up via the API's date-bounded NAV endpoint, per active scheme batch.

    Only the year partitions the new rows touch are rewritten, so a daily refresh costs
    a fraction of a full rebuild. Falls back to a full download when no lake exists yet.
    """
    s = settings or get_settings()
    s.ensure_dirs()
    started = datetime.now(UTC).replace(tzinfo=None)
    rid = run_id or started.strftime("%Y%m%dT%H%M%S")
    if not any(nav_dataset_dir(s).glob("**/*.parquet")):
        log_event(logger, "refresh.no_local_dataset_falling_back_to_full")
        return run(force=True, settings=s, run_id=rid)

    source = TigZigSource(s)
    with connect(s) as con:
        init_schema(con)
        register_nav_view(con, s)
        tune_for_bulk(con, s)
        since = scalar(
            con, "SELECT CAST(max(date) - INTERVAL (?) DAY AS DATE) FROM nav_daily", [days]
        )
        codes = [
            r[0]
            for r in con.execute(
                "SELECT scheme_code FROM scheme_master WHERE is_active ORDER BY scheme_code"
            ).fetchall()
        ]
        log_event(logger, "refresh.start", since=str(since), schemes=len(codes))
        frames: list[pd.DataFrame] = []
        for i in range(0, len(codes), 50):
            batch = codes[i : i + 50]
            data = source.fetch_many_nav(batch, since=str(since))
            if not data.empty:
                frames.append(data)
            print(
                f"  refreshed {min(i + 50, len(codes))}/{len(codes)} schemes", end="\r", flush=True
            )
        print()
        if not frames:
            empty = {"mode": "incremental", "since": str(since), "new_rows": 0, "years": []}
            record_ingest(con, rid, "data-refresh", started, "ok", row_count=0, details=empty)
            log_event(logger, "refresh.no_new_rows", since=str(since))
            return empty

        new = pd.concat(frames, ignore_index=True)
        con.register("nav_new", new.loc[:, ["scheme_code", "date", "nav"]])
        years = [
            int(y)
            for (y,) in con.execute(
                "SELECT DISTINCT year(TRY_CAST(date AS DATE)) FROM nav_new "
                "WHERE TRY_CAST(date AS DATE) IS NOT NULL ORDER BY 1"
            ).fetchall()
        ]
        # Only the affected years are read back and rewritten; every other partition file
        # on disk is left exactly as it was. The years come from DuckDB, not from a client.
        touched = ", ".join(str(y) for y in years)
        rows = write_nav_dataset(
            con,
            "SELECT scheme_code, date, nav, 0 AS priority FROM "
            f"read_parquet('{nav_glob(s)}', hive_partitioning=1) WHERE year IN ({touched}) "
            "UNION ALL SELECT scheme_code, date, nav, 1 AS priority FROM nav_new",
            s,
            replace_all=False,
        )
        con.unregister("nav_new")
        n_monthly, n_returns = refresh_monthly_tables(con)
        meta = {
            "mode": "incremental",
            "since": str(since),
            "new_rows": len(new),
            "years_rewritten": years,
            "rows": rows,
            "nav_monthly_rows": n_monthly,
            "monthly_return_rows": n_returns,
        }
        record_ingest(con, rid, "data-refresh", started, "ok", row_count=rows, details=meta)
    log_event(logger, "refresh.done", **meta)
    return meta
