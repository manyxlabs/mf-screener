"""DuckDB store: canonical schema, connection helper and ingest bookkeeping."""

from __future__ import annotations

import json
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Final

import duckdb
import pandas as pd

from .config import ROLLING_HORIZONS, TRAILING_HORIZONS, Settings, get_settings
from .enrich import REGISTRY as ENRICH_REGISTRY
from .enrich import assert_disjoint_from_snapshot

# Generated rather than typed out so a change to ROLLING_HORIZONS cannot leave the
# snapshot tables a horizon behind the pipeline that fills them.
SCHEME_ROLLING_COLUMNS: dict[str, str] = {
    f"rolling_{h}y_{stat}": kind
    for h in ROLLING_HORIZONS
    for stat, kind in (
        ("mean", "DOUBLE"),
        ("median", "DOUBLE"),
        ("min", "DOUBLE"),
        ("max", "DOUBLE"),
        ("std", "DOUBLE"),
        ("positive_pct", "DOUBLE"),
        ("window_count", "INTEGER"),
        ("beat_category_pct", "DOUBLE"),
        ("beat_benchmark_pct", "DOUBLE"),
    )
}
CATEGORY_ROLLING_COLUMNS: dict[str, str] = {
    f"rolling_{h}y_median": "DOUBLE" for h in ROLLING_HORIZONS
}
SIP_XIRR_COLUMNS: dict[str, str] = {f"sip_xirr_{h}y": "DOUBLE" for h in TRAILING_HORIZONS}
ROLLING_SIP_XIRR_COLUMNS: dict[str, str] = {
    f"rolling_sip_xirr_{h}y_median": "DOUBLE" for h in (3, 5)
}


def _declare(columns: dict[str, str]) -> str:
    return "".join(f"    {name} {kind},\n" for name, kind in columns.items())


_SCHEMA_TEMPLATE = """
CREATE TABLE IF NOT EXISTS scheme_master (
    scheme_code        VARCHAR PRIMARY KEY,
    scheme_name        VARCHAR NOT NULL,
    amc                VARCHAR,
    scheme_type        VARCHAR,
    category           VARCHAR,
    sub_category       VARCHAR,
    clean_category     VARCHAR,
    clean_sub_category VARCHAR,
    cap_band           VARCHAR,
    peer_group         VARCHAR,
    style              VARCHAR,
    plan               VARCHAR,
    option             VARCHAR,
    clean_plan         VARCHAR,
    clean_option       VARCHAR,
    isin_growth        VARCHAR,
    isin_dividend      VARCHAR,
    launch_date        DATE,
    first_nav_date     DATE,
    last_nav_date      DATE,
    latest_nav         DOUBLE,
    latest_nav_date    DATE,
    latest_aum         DOUBLE,
    aum_date           DATE,
    aum_quarter        VARCHAR,
    is_active          BOOLEAN,
    is_stale           BOOLEAN,
    fund_age_years     DOUBLE,
    source             VARCHAR NOT NULL,
    ingested_at        TIMESTAMP NOT NULL
);

-- nav_daily is created by mf_analytics.ingest.nav.register_nav_view: a view over the
-- year-partitioned parquet lake when it exists, an empty table before first ingest.

CREATE TABLE IF NOT EXISTS nav_monthly (
    scheme_code VARCHAR NOT NULL,
    date        DATE NOT NULL,
    nav         DOUBLE,
    obs_date    DATE,
    created_at  TIMESTAMP NOT NULL,
    PRIMARY KEY (scheme_code, date)
);

-- Schemes whose source history contains a non-positive NAV. Those rows never enter the
-- lake (AMFI files 0.00 as a matured scheme's terminal marker, not as a price), so this
-- is the only record that the exclusion happened and which schemes it touched.
CREATE TABLE IF NOT EXISTS nav_zero_excluded (
    scheme_code    VARCHAR PRIMARY KEY,
    excluded_rows  BIGINT NOT NULL,
    last_zero_date DATE,
    recorded_at    TIMESTAMP NOT NULL
);

CREATE TABLE IF NOT EXISTS rolling_returns_monthly (
    scheme_code         VARCHAR NOT NULL,
    horizon_years       INTEGER NOT NULL,
    date                DATE NOT NULL,
    rolling_cagr        DOUBLE,
    methodology_version VARCHAR NOT NULL,
    PRIMARY KEY (scheme_code, horizon_years, date)
);

CREATE TABLE IF NOT EXISTS monthly_returns (
    scheme_code    VARCHAR NOT NULL,
    date           DATE NOT NULL,
    monthly_return DOUBLE,
    log_return     DOUBLE,
    PRIMARY KEY (scheme_code, date)
);

CREATE TABLE IF NOT EXISTS benchmarks (
    benchmark_id                VARCHAR NOT NULL,
    benchmark_name              VARCHAR NOT NULL,
    asset_class                 VARCHAR,
    currency                    VARCHAR NOT NULL,
    source                      VARCHAR NOT NULL,
    date                        DATE NOT NULL,
    price_or_total_return_index DOUBLE NOT NULL,
    monthly_return              DOUBLE,
    PRIMARY KEY (benchmark_id, date)
);

CREATE TABLE IF NOT EXISTS scheme_benchmark_map (
    scheme_code    VARCHAR NOT NULL,
    benchmark_id   VARCHAR NOT NULL,
    source_type    VARCHAR NOT NULL,
    confidence     VARCHAR NOT NULL,
    effective_from DATE,
    effective_to   DATE,
    notes          VARCHAR,
    PRIMARY KEY (scheme_code, benchmark_id)
);

CREATE TABLE IF NOT EXISTS category_monthly_returns (
    category_key                    VARCHAR NOT NULL,
    date                            DATE NOT NULL,
    category_return_equal_weighted  DOUBLE,
    category_return_median          DOUBLE,
    category_return_aum_weighted    DOUBLE,
    eligible_scheme_count           INTEGER NOT NULL,
    methodology_version             VARCHAR NOT NULL,
    PRIMARY KEY (category_key, date)
);

CREATE TABLE IF NOT EXISTS category_metrics_snapshot (
    category_key          VARCHAR NOT NULL,
    as_of_date            DATE NOT NULL,
    level                 VARCHAR NOT NULL,
    label                 VARCHAR NOT NULL,
    cagr_1y DOUBLE, cagr_3y DOUBLE, cagr_5y DOUBLE, cagr_10y DOUBLE,
{category_rolling}    volatility_5y DOUBLE,
    eligible_scheme_count INTEGER NOT NULL,
    methodology_version   VARCHAR NOT NULL,
    PRIMARY KEY (category_key, as_of_date)
);

CREATE TABLE IF NOT EXISTS scheme_metrics_snapshot (
    scheme_code VARCHAR NOT NULL,
    as_of_date  DATE NOT NULL,

    cagr_1y DOUBLE, cagr_3y DOUBLE, cagr_5y DOUBLE, cagr_10y DOUBLE,
    cagr_1y_start DATE, cagr_3y_start DATE, cagr_5y_start DATE, cagr_10y_start DATE,
{sip_xirr}{rolling_sip_xirr}
{scheme_rolling}
    category_return_3y DOUBLE, category_return_5y DOUBLE, category_return_10y DOUBLE,
    fund_minus_category_3y DOUBLE, fund_minus_category_5y DOUBLE, fund_minus_category_10y DOUBLE,
    fund_div_category_3y DOUBLE, fund_div_category_5y DOUBLE, fund_div_category_10y DOUBLE,
    category_peer_count_3y INTEGER, category_peer_count_5y INTEGER, category_peer_count_10y INTEGER,
    category_methodology VARCHAR,

    benchmark_return_3y DOUBLE, benchmark_return_5y DOUBLE, benchmark_return_10y DOUBLE,
    fund_minus_benchmark_3y DOUBLE, fund_minus_benchmark_5y DOUBLE, fund_minus_benchmark_10y DOUBLE,

    information_ratio_vs_category_3y DOUBLE, information_ratio_vs_category_5y DOUBLE,
    information_ratio_vs_category_10y DOUBLE,
    information_ratio_vs_benchmark_3y DOUBLE, information_ratio_vs_benchmark_5y DOUBLE,
    information_ratio_vs_benchmark_10y DOUBLE,

    sharpe_3y DOUBLE, sharpe_5y DOUBLE, sharpe_10y DOUBLE,
    sortino_3y DOUBLE, sortino_5y DOUBLE, sortino_10y DOUBLE,
    volatility_3y DOUBLE, volatility_5y DOUBLE, volatility_10y DOUBLE,
    downside_deviation_3y DOUBLE, downside_deviation_5y DOUBLE, downside_deviation_10y DOUBLE,
    tracking_error_3y DOUBLE, tracking_error_5y DOUBLE, tracking_error_10y DOUBLE,
    alpha_3y DOUBLE, alpha_5y DOUBLE, alpha_10y DOUBLE,
    beta_3y DOUBLE, beta_5y DOUBLE, beta_10y DOUBLE,
    r_squared_3y DOUBLE, r_squared_5y DOUBLE, r_squared_10y DOUBLE,
    regression_obs_3y INTEGER, regression_obs_5y INTEGER, regression_obs_10y INTEGER,
    max_drawdown_3y DOUBLE, max_drawdown_5y DOUBLE, max_drawdown_10y DOUBLE,
    max_drawdown_5y_peak DATE, max_drawdown_5y_trough DATE,
    calmar_3y DOUBLE, calmar_5y DOUBLE, calmar_10y DOUBLE,

    benchmark_id VARCHAR,
    peer_universe VARCHAR NOT NULL,
    category_key VARCHAR,
    monthly_obs_count INTEGER,
    nav_gap_months INTEGER,
    data_quality_flags VARCHAR,
    missing_reasons VARCHAR,
    methodology_version VARCHAR NOT NULL,
    computed_at TIMESTAMP NOT NULL,
    PRIMARY KEY (scheme_code, as_of_date)
);

-- TER is disclosed per fund and plan, never per scheme code, so this table is the
-- result of a name match and carries what it matched on for anyone auditing a value.
CREATE TABLE IF NOT EXISTS scheme_score_snapshot (
    scheme_code    VARCHAR NOT NULL,
    as_of_date     DATE NOT NULL,
    score          DOUBLE,
    score_coverage DOUBLE,
    score_status   VARCHAR,
    PRIMARY KEY (scheme_code, as_of_date)
);

CREATE TABLE IF NOT EXISTS scheme_ter (
    scheme_code        VARCHAR PRIMARY KEY,
    expense_ratio      DOUBLE NOT NULL,
    base_ter           DOUBLE,
    plan               VARCHAR NOT NULL,
    source_scheme_name VARCHAR NOT NULL,
    match_key          VARCHAR NOT NULL,
    source_url         VARCHAR NOT NULL,
    imported_at        TIMESTAMP NOT NULL
);

-- scheme_ter as it stood at each past month-end, so a backtest prices a past ranking
-- with the fee charged then. Same name match; matched against today's names, so a fund
-- renamed since is absent for the months before its rename rather than mispriced.
CREATE TABLE IF NOT EXISTS scheme_ter_history (
    ter_month          DATE NOT NULL,
    scheme_code        VARCHAR NOT NULL,
    expense_ratio      DOUBLE NOT NULL,
    base_ter           DOUBLE,
    plan               VARCHAR NOT NULL,
    source_scheme_name VARCHAR NOT NULL,
    match_key          VARCHAR NOT NULL,
    source_url         VARCHAR NOT NULL,
    imported_at        TIMESTAMP NOT NULL,
    PRIMARY KEY (scheme_code, ter_month)
);

-- T2.1 fund family identity: maps a retired scheme code to the successor that
-- carries its fund_family_id forward. Populated only where the evidence (a shared
-- ISIN, or one unambiguous name match) is unambiguous, so an unmapped retired code
-- means the evidence did not clear that bar, not that nothing happened to it.
CREATE TABLE IF NOT EXISTS scheme_alias (
    old_scheme_code VARCHAR PRIMARY KEY,
    new_scheme_code VARCHAR NOT NULL,
    effective_date  DATE,
    evidence        VARCHAR NOT NULL,
    recorded_at     TIMESTAMP NOT NULL
);

CREATE TABLE IF NOT EXISTS ingest_log (
    run_id      VARCHAR NOT NULL,
    step        VARCHAR NOT NULL,
    started_at  TIMESTAMP NOT NULL,
    finished_at TIMESTAMP,
    status      VARCHAR NOT NULL,
    source_url  VARCHAR,
    row_count   BIGINT,
    checksum    VARCHAR,
    details     VARCHAR,
    PRIMARY KEY (run_id, step)
);

-- Provenance for every raw artefact the lake was built from: which bytes, from where,
-- and how many rows they held. Any stored metric traces back through here.
CREATE TABLE IF NOT EXISTS raw_file (
    path               VARCHAR PRIMARY KEY,
    kind               VARCHAR NOT NULL,
    source             VARCHAR NOT NULL,
    source_url         VARCHAR,
    format             VARCHAR,
    bytes              BIGINT,
    sha256             VARCHAR,
    etag               VARCHAR,
    last_modified      VARCHAR,
    file_row_count     BIGINT,
    manifest_row_count BIGINT,
    ingested_rows      BIGINT,
    downloaded_at      TIMESTAMP,
    ingested_at        TIMESTAMP,
    details            VARCHAR
);
"""

SCHEMA_SQL = _SCHEMA_TEMPLATE.format(
    category_rolling=_declare(CATEGORY_ROLLING_COLUMNS),
    scheme_rolling=_declare(SCHEME_ROLLING_COLUMNS),
    sip_xirr=_declare(SIP_XIRR_COLUMNS),
    rolling_sip_xirr=_declare(ROLLING_SIP_XIRR_COLUMNS),
)


def scalar(con: duckdb.DuckDBPyConnection, sql: str, params: list[Any] | None = None) -> Any:
    """First column of the first row. An aggregate that returns nothing is a bug, not a null."""
    row = con.execute(sql, params or []).fetchone()
    if row is None:
        raise RuntimeError(f"Query returned no rows: {sql}")
    return row[0]


class StoreLockedError(RuntimeError):
    """The DuckDB file is held by another process, so this command cannot write."""


@contextmanager
def connect(
    settings: Settings | None = None, read_only: bool = False
) -> Iterator[duckdb.DuckDBPyConnection]:
    s = settings or get_settings()
    path = Path(s.mf_duckdb_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    try:
        con = duckdb.connect(str(path), read_only=read_only)
    except duckdb.IOException as exc:
        # DuckDB is single-process: a running API holds the file open.
        raise StoreLockedError(
            f"{path} is open in another process (usually the running API server).\n"
            "Stop it (Ctrl-C in the `make api` terminal) and re-run this command, or "
            "trigger the same step through the API with:\n"
            '  curl -X POST localhost:8000/admin/refresh -H "content-type: application/json" '
            '-d \'{"step": "metrics-build"}\''
        ) from exc
    try:
        yield con
    finally:
        con.close()


MASTER_ADDED_COLUMNS: Final[dict[str, str]] = {
    "cap_band": "VARCHAR",
    "peer_group": "VARCHAR",
    "style": "VARCHAR",
    "search_text": "VARCHAR",
    "fund_family_id": "VARCHAR",
}

# Every alphanumeric word in the name and AMC, plus every prefix of each word from
# length 2 up. A typeahead needs the fund to be found while the user is still typing
# "flex" of "flexi", which plain FTS tokenisation - whole tokens only - does not give;
# indexing prefixes as separate terms lets bm25 match them without a LIKE scan.
_SEARCH_TEXT_SQL = """
UPDATE scheme_master SET search_text = sub.search_text
FROM (
    SELECT scheme_code,
        (SELECT string_agg(tok, ' ')
         FROM (SELECT unnest(w) AS word
               FROM (SELECT regexp_split_to_array(
                         lower(scheme_name || ' ' || coalesce(amc, '')), '[^a-z0-9]+'
                     ) AS w) words) tokens,
              LATERAL (SELECT substr(word, 1, i) AS tok
                       FROM range(2, length(word) + 1) AS r(i)) prefixes
         WHERE length(word) >= 1
        ) AS search_text
    FROM scheme_master
) sub
WHERE scheme_master.scheme_code = sub.scheme_code
"""


def refresh_search_index(con: duckdb.DuckDBPyConnection) -> None:
    """Rebuild the scheme_master full-text search index used by GET /search.

    Runs as part of schema init rather than lazily at query time, so a fresh store
    is always searchable. Both the text rebuild and the index build are well under a
    second at 38k rows, so doing this on every init is cheaper than tracking whether
    scheme_master changed since the last one.
    """
    con.execute("INSTALL fts")
    con.execute("LOAD fts")
    con.execute(_SEARCH_TEXT_SQL)
    con.execute(
        "PRAGMA create_fts_index('scheme_master', 'scheme_code', 'search_text', "
        "overwrite=1, stemmer='none', lower=1, strip_accents=1)"
    )


def init_schema(con: duckdb.DuckDBPyConnection) -> None:
    """Create the schema, and widen existing tables that have since grown a column.

    `CREATE TABLE IF NOT EXISTS` leaves an existing store on its old shape, so a new
    rolling horizon or classification field would fail the insert with a column-count
    mismatch. Every column added here is wholly derived, so it reads NULL until the
    next build of the table it belongs to.
    """
    con.execute(SCHEMA_SQL)
    for table, columns in (
        ("scheme_master", MASTER_ADDED_COLUMNS),
        ("scheme_metrics_snapshot", SCHEME_ROLLING_COLUMNS),
        ("scheme_metrics_snapshot", SIP_XIRR_COLUMNS),
        ("scheme_metrics_snapshot", ROLLING_SIP_XIRR_COLUMNS),
        ("category_metrics_snapshot", CATEGORY_ROLLING_COLUMNS),
    ):
        for name, kind in columns.items():
            con.execute(f"ALTER TABLE {table} ADD COLUMN IF NOT EXISTS {name} {kind}")
    ensure_category_history_table(con)
    ensure_aum_history_table(con)
    ENRICH_REGISTRY.init_schema(con)
    snapshot_columns = {
        r[0]
        for r in con.execute(
            "SELECT column_name FROM information_schema.columns "
            "WHERE table_name = 'scheme_metrics_snapshot'"
        ).fetchall()
    }
    assert_disjoint_from_snapshot(snapshot_columns)
    refresh_search_index(con)


def record_ingest(
    con: duckdb.DuckDBPyConnection,
    run_id: str,
    step: str,
    started_at: datetime,
    status: str,
    *,
    source_url: str | None = None,
    row_count: int | None = None,
    checksum: str | None = None,
    details: dict[str, Any] | None = None,
) -> None:
    con.execute(
        """
        INSERT OR REPLACE INTO ingest_log
            (run_id, step, started_at, finished_at, status, source_url, row_count,
             checksum, details)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        [
            run_id,
            step,
            started_at,
            datetime.now(UTC).replace(tzinfo=None),
            status,
            source_url,
            row_count,
            checksum,
            json.dumps(details or {}, default=str),
        ],
    )


def record_raw_file(
    con: duckdb.DuckDBPyConnection,
    path: Path,
    kind: str,
    source: str,
    meta: dict[str, Any],
) -> None:
    """Register the raw artefact a load came from, keyed by path so a re-ingest replaces it."""
    con.execute(
        """
        INSERT OR REPLACE INTO raw_file
            (path, kind, source, source_url, format, bytes, sha256, etag, last_modified,
             file_row_count, manifest_row_count, ingested_rows, downloaded_at, ingested_at,
             details)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        [
            str(path),
            kind,
            source,
            meta.get("url"),
            meta.get("format"),
            meta.get("bytes"),
            meta.get("sha256"),
            meta.get("etag"),
            meta.get("last_modified"),
            meta.get("file_row_count"),
            meta.get("manifest_row_count"),
            meta.get("ingested_rows"),
            meta.get("downloaded_at"),
            datetime.now(UTC).replace(tzinfo=None),
            json.dumps(meta, default=str),
        ],
    )


def raw_file_sha256(con: duckdb.DuckDBPyConnection, path: Path) -> str | None:
    row = con.execute("SELECT sha256 FROM raw_file WHERE path = ?", [str(path)]).fetchone()
    return row[0] if row else None


def write_sidecar(path: Path, meta: dict[str, Any]) -> None:
    """Provenance next to every raw artefact, so any metric can be traced to a snapshot."""
    path.write_text(json.dumps(meta, indent=2, default=str))


# --- T2.1 fund family identity: scheme_alias upkeep -------------------------------


# --- T2.3: AUM history --------------------------------------------------------------
#
# scheme_master's latest_aum is one quarterly figure with no memory of the prior
# quarter, so asset bloat - the central risk in small- and mid-cap funds - is
# invisible. This table is the memory: one row per (scheme_code, aum_quarter) the
# master has ever reported, appended by mf_analytics.ingest.master.record_aum_history
# and never overwritten, so aum_growth_4q always has a real series to read from.
AUM_HISTORY_SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS scheme_aum_history (
    scheme_code VARCHAR NOT NULL,
    aum_quarter VARCHAR NOT NULL,
    aum_date    DATE,
    latest_aum  DOUBLE,
    recorded_at TIMESTAMP NOT NULL,
    PRIMARY KEY (scheme_code, aum_quarter)
);
"""


def ensure_aum_history_table(con: duckdb.DuckDBPyConnection) -> None:
    con.execute(AUM_HISTORY_SCHEMA_SQL)


def append_aum_history_rows(con: duckdb.DuckDBPyConnection, rows: list[dict[str, Any]]) -> int:
    """Append one row per (scheme_code, aum_quarter) not already recorded.

    INSERT OR IGNORE rather than REPLACE: a quarter AMFI has already published is
    never re-derived from a later ingest that happens to repeat it, so the history
    stays append-only. Returns how many rows were actually new.
    """
    if not rows:
        return 0
    before = scalar(con, "SELECT count(*) FROM scheme_aum_history")
    # One statement over a registered frame rather than executemany: a quarter of AMFI
    # history is 8,000 rows, and a round trip each was most of the import's wall clock.
    frame = pd.DataFrame(
        {
            "scheme_code": [str(r["scheme_code"]) for r in rows],
            "aum_quarter": [r["aum_quarter"] for r in rows],
            "aum_date": [r.get("aum_date") for r in rows],
            "latest_aum": [r.get("latest_aum") for r in rows],
            "recorded_at": datetime.now(UTC).replace(tzinfo=None),
        }
    )
    con.register("aum_history_new", frame)
    try:
        con.execute(
            "INSERT OR IGNORE INTO scheme_aum_history "
            "(scheme_code, aum_quarter, aum_date, latest_aum, recorded_at) "
            "SELECT scheme_code, aum_quarter, aum_date, latest_aum, recorded_at "
            "FROM aum_history_new"
        )
    finally:
        con.unregister("aum_history_new")
    after = scalar(con, "SELECT count(*) FROM scheme_aum_history")
    return int(after - before)


def upsert_scheme_aliases(con: duckdb.DuckDBPyConnection, rows: list[dict[str, Any]]) -> None:
    """Record retired -> successor scheme code mappings. Never deletes an existing row:

    a code once retired stays retired, and re-running the same ingest must not lose
    an alias that a later, noisier diff failed to reproduce.
    """
    if not rows:
        return
    con.executemany(
        """
        INSERT OR REPLACE INTO scheme_alias
            (old_scheme_code, new_scheme_code, effective_date, evidence, recorded_at)
        VALUES (?, ?, ?, ?, ?)
        """,
        [
            [
                r["old_scheme_code"],
                r["new_scheme_code"],
                r.get("effective_date"),
                r["evidence"],
                datetime.now(UTC).replace(tzinfo=None),
            ]
            for r in rows
        ],
    )


# --- T2.2: category history --------------------------------------------------------
#
# clean_sub_category on scheme_master is a single current value with no memory of what
# it used to be. This table is the memory: one row per closed or currently-open
# classification segment, appended by mf_analytics.ingest.master.record_category_history
# whenever a master ingest sees a scheme's category differ from what is stored. History
# only starts from the ingest that first observes a change - nothing before that is
# backfilled, because it was never observed.

CATEGORY_HISTORY_SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS scheme_category_history (
    scheme_code        VARCHAR NOT NULL,
    clean_category     VARCHAR,
    clean_sub_category VARCHAR,
    valid_from         DATE NOT NULL,
    valid_to           DATE,
    observed_run_id    VARCHAR NOT NULL,
    recorded_at        TIMESTAMP NOT NULL,
    PRIMARY KEY (scheme_code, valid_from)
);
"""


def ensure_category_history_table(con: duckdb.DuckDBPyConnection) -> None:
    """Create scheme_category_history and widen scheme_metrics_snapshot for it.

    Kept as its own function, called from init_schema, so this addition never has to
    edit the shared SCHEMA_SQL template or the widening loop above.
    """
    con.execute(CATEGORY_HISTORY_SCHEMA_SQL)
    con.execute(
        "ALTER TABLE scheme_metrics_snapshot ADD COLUMN IF NOT EXISTS category_resolution VARCHAR"
    )
