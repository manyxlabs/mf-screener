"""Scheme-master ingestion: download, normalise, classify, load."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any, cast

import pandas as pd

from ..classify import classify_frame, fund_family_key
from ..config import Settings, get_settings
from ..db import (
    append_aum_history_rows,
    connect,
    init_schema,
    record_ingest,
    record_raw_file,
    upsert_scheme_aliases,
    write_sidecar,
)
from ..logging_setup import get_logger, log_event
from ..sources.tigzig import MASTER_COLUMN_MAP, TigZigSource

logger = get_logger(__name__)

CANONICAL_COLUMNS = [
    "scheme_code",
    "scheme_name",
    "amc",
    "scheme_type",
    "category",
    "sub_category",
    "clean_category",
    "clean_sub_category",
    "cap_band",
    "style",
    "plan",
    "option",
    "clean_plan",
    "clean_option",
    "fund_family_id",
    "isin_growth",
    "isin_dividend",
    "launch_date",
    "first_nav_date",
    "last_nav_date",
    "latest_nav",
    "latest_nav_date",
    "latest_aum",
    "aum_date",
    "aum_quarter",
    "is_active",
    "is_stale",
    "fund_age_years",
    "source",
    "ingested_at",
]


def normalise_master(raw: pd.DataFrame, source_name: str) -> pd.DataFrame:
    """Map source columns to the canonical schema and derive clean classification fields."""
    missing = set(MASTER_COLUMN_MAP) - set(raw.columns)
    if missing:
        raise ValueError(f"Source master is missing expected columns: {sorted(missing)}")
    df = raw.rename(columns=MASTER_COLUMN_MAP).copy()
    df["scheme_code"] = df["scheme_code"].astype(str).str.strip()
    df = classify_frame(df)
    df["sub_category"] = df["category_sub"]
    df["plan"] = df["scheme_plan"]
    df["option"] = df["scheme_option"]
    for col in ("first_nav_date", "last_nav_date", "latest_nav_date", "aum_date"):
        df[col] = pd.to_datetime(df[col], errors="coerce").dt.date
    # AMFI publishes no launch date; the first NAV date is the closest honest proxy.
    df["launch_date"] = df["first_nav_date"]
    df["latest_nav"] = pd.to_numeric(df["latest_nav"], errors="coerce")
    df["latest_aum"] = pd.to_numeric(df["latest_aum"], errors="coerce")
    first = pd.to_datetime(df["first_nav_date"], errors="coerce")
    last = pd.to_datetime(df["last_nav_date"], errors="coerce")
    df["fund_age_years"] = ((last - first).dt.days / 365.25).round(4)
    df["is_active"] = df["is_active"].astype("boolean")
    df["is_stale"] = df["is_stale"].astype("boolean")
    df["source"] = source_name
    df["ingested_at"] = datetime.now(UTC).replace(tzinfo=None)
    return df.loc[:, CANONICAL_COLUMNS].drop_duplicates(subset=["scheme_code"])


def load_master(df: pd.DataFrame, settings: Settings | None = None) -> int:
    s = settings or get_settings()
    processed = s.processed_dir / "scheme_master.parquet"
    processed.parent.mkdir(parents=True, exist_ok=True)
    df.to_parquet(processed, index=False)
    with connect(s) as con:
        init_schema(con)
        con.register("df_master", df)
        # One transaction: DuckDB autocommits each statement, so a delete followed by a
        # failing insert would otherwise leave the master empty rather than untouched.
        con.execute("BEGIN TRANSACTION")
        try:
            con.execute("DELETE FROM scheme_master")
            # Target columns are named, not positional: a column added by a migration
            # lands at the end of the table and would otherwise shift every value.
            names = ", ".join(CANONICAL_COLUMNS)
            con.execute(f"INSERT INTO scheme_master ({names}) SELECT {names} FROM df_master")
        except Exception:
            con.execute("ROLLBACK")
            raise
        con.execute("COMMIT")
        con.unregister("df_master")
    return len(df)


def run(
    force: bool = False, settings: Settings | None = None, run_id: str | None = None
) -> dict[str, Any]:
    s = settings or get_settings()
    s.ensure_dirs()
    started = datetime.now(UTC).replace(tzinfo=None)
    rid = run_id or started.strftime("%Y%m%dT%H%M%S")
    source = TigZigSource(s)
    dest = s.raw_dir / f"scheme_master.{s.mf_master_format}"
    meta = source.fetch_master(dest, force=force)
    raw = source.read_master(dest)
    df = normalise_master(raw, source.name)
    # Must run before load_master overwrites scheme_master: that table is the only
    # place the previous classification is still visible.
    category_changes = record_category_history(df, s, rid, started)
    aliased_codes = record_scheme_aliases(df, s, started)
    aum_history_rows = record_aum_history(df, s)
    rows = load_master(df, s)
    meta.update(
        {
            "rows": rows,
            "ingested_rows": rows,
            "file_row_count": len(raw),
            "source_columns": list(raw.columns),
            "retrieved_at": started.isoformat(),
            "category_changes": category_changes,
            "aliased_codes": aliased_codes,
            "aum_history_rows": aum_history_rows,
        }
    )
    write_sidecar(dest.with_suffix(dest.suffix + ".meta.json"), meta)
    with connect(s) as con:
        init_schema(con)
        record_raw_file(con, dest, "scheme_master", source.name, meta)
        record_ingest(
            con,
            rid,
            "data-master",
            started,
            "ok",
            source_url=meta.get("url"),
            row_count=rows,
            checksum=meta.get("sha256"),
            details=meta,
        )
    log_event(logger, "master.loaded", rows=rows, path=str(dest), skipped=meta.get("skipped"))
    return meta


# --- T2.2: category history diff ---------------------------------------------------


def record_category_history(
    incoming: pd.DataFrame, settings: Settings, run_id: str, observed_at: datetime
) -> int:
    """Append scheme_category_history rows for every scheme whose classification moved.

    Compares `incoming` (about to overwrite scheme_master) against what is currently
    stored. A scheme with no prior row (first ingest ever) or an unchanged category
    writes nothing: history only accrues from the ingest that first observes a change,
    it is never backfilled. A changed scheme gets two rows: the old classification
    closed off as of this run, and the new one opened as of this run (valid_to NULL,
    i.e. current) so a later run can close it in turn.

    Returns the number of schemes whose category changed.
    """
    with connect(settings) as con:
        init_schema(con)
        prior = con.execute(
            "SELECT scheme_code, clean_category, clean_sub_category, ingested_at FROM scheme_master"
        ).fetch_df()
        if prior.empty:
            return 0
        merged = prior.merge(
            incoming[["scheme_code", "clean_category", "clean_sub_category"]],
            on="scheme_code",
            how="inner",
            suffixes=("_old", "_new"),
        )
        changed = merged[
            (merged["clean_category_old"].fillna("") != merged["clean_category_new"].fillna(""))
            | (
                merged["clean_sub_category_old"].fillna("")
                != merged["clean_sub_category_new"].fillna("")
            )
        ]
        if changed.empty:
            return 0
        observed_date = observed_at.date()
        recorded_at = datetime.now(UTC).replace(tzinfo=None)
        for row in changed.itertuples(index=False):
            open_row = con.execute(
                "SELECT 1 FROM scheme_category_history WHERE scheme_code = ? AND valid_to IS NULL",
                [row.scheme_code],
            ).fetchone()
            if open_row is not None:
                con.execute(
                    "UPDATE scheme_category_history SET valid_to = ? "
                    "WHERE scheme_code = ? AND valid_to IS NULL",
                    [observed_date, row.scheme_code],
                )
            else:
                # No segment on record yet: the true start of the old classification
                # was never observed, so its earliest defensible bound is the last
                # ingest that confirmed it, not an invented earlier date.
                prior_seen = row.ingested_at
                valid_from = (
                    prior_seen.date()
                    if isinstance(prior_seen, pd.Timestamp) and pd.notna(prior_seen)
                    else observed_date
                )
                con.execute(
                    "INSERT INTO scheme_category_history "
                    "(scheme_code, clean_category, clean_sub_category, valid_from, "
                    " valid_to, observed_run_id, recorded_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
                    [
                        row.scheme_code,
                        row.clean_category_old,
                        row.clean_sub_category_old,
                        valid_from,
                        observed_date,
                        run_id,
                        recorded_at,
                    ],
                )
            con.execute(
                "INSERT INTO scheme_category_history "
                "(scheme_code, clean_category, clean_sub_category, valid_from, "
                " valid_to, observed_run_id, recorded_at) VALUES (?, ?, ?, ?, NULL, ?, ?)",
                [
                    row.scheme_code,
                    row.clean_category_new,
                    row.clean_sub_category_new,
                    observed_date,
                    run_id,
                    recorded_at,
                ],
            )
        return len(changed)


# --- T2.1: retired-code diff --------------------------------------------------------


def record_scheme_aliases(incoming: pd.DataFrame, settings: Settings, observed_at: datetime) -> int:
    """Map a scheme code retired by this ingest to its successor, where the evidence
    is unambiguous.

    Must run before `load_master` overwrites scheme_master: the retired codes are
    only ever visible in the row about to be replaced. A retired code with an ISIN
    that now shows up in exactly one new code is that fund continuing under a new
    code; failing that, an exact `fund_family_key` match to exactly one new code is
    the fallback. Anything else - no candidate, or more than one - is left unmapped:
    a wrong merge here would misattribute a fund's whole history.
    """
    with connect(settings) as con:
        init_schema(con)
        prior = con.execute(
            "SELECT scheme_code, scheme_name, amc, isin_growth, isin_dividend FROM scheme_master"
        ).fetch_df()
        if prior.empty:
            return 0
        prior_codes = set(prior["scheme_code"])
        incoming_codes = set(incoming["scheme_code"])
        retired = prior_codes - incoming_codes
        if not retired:
            return 0
        new_only = incoming[incoming["scheme_code"].isin(incoming_codes - prior_codes)]
        if new_only.empty:
            return 0

        def isin_values(row: pd.Series) -> set[str]:
            return {
                str(v).strip()
                for v in (row.get("isin_growth"), row.get("isin_dividend"))
                if str(v or "").strip() and str(v).strip().lower() != "nan"
            }

        new_isin_to_codes: dict[str, list[str]] = {}
        for _, row in new_only.iterrows():
            for isin in isin_values(row):
                new_isin_to_codes.setdefault(isin, []).append(row["scheme_code"])
        new_key_to_codes: dict[str, list[str]] = {}
        for _, row in new_only.iterrows():
            key = fund_family_key(row.get("amc"), row.get("scheme_name"))
            if key is not None:
                new_key_to_codes.setdefault(key, []).append(row["scheme_code"])

        aliases: list[dict[str, Any]] = []
        prior_by_code = prior.set_index("scheme_code")
        for old_code in retired:
            old_row = prior_by_code.loc[old_code]
            candidates: set[str] | None = None
            for isin in isin_values(old_row):
                matches = new_isin_to_codes.get(isin, [])
                if len(matches) == 1:
                    candidates = {matches[0]}
                    evidence = f"isin_match:{isin}"
                    break
            if candidates is None:
                key = fund_family_key(old_row.get("amc"), old_row.get("scheme_name"))
                matches = new_key_to_codes.get(key, []) if key is not None else []
                if len(matches) == 1:
                    candidates = {matches[0]}
                    evidence = f"name_match:{key}"
            if candidates is None:
                continue
            aliases.append(
                {
                    "old_scheme_code": old_code,
                    "new_scheme_code": next(iter(candidates)),
                    "effective_date": observed_at.date(),
                    "evidence": evidence,
                }
            )
        upsert_scheme_aliases(con, aliases)
        return len(aliases)


# --- T2.3: AUM history ---------------------------------------------------------------


def record_aum_history(incoming: pd.DataFrame, settings: Settings) -> int:
    """Append one scheme_aum_history row per scheme for the AUM quarter this ingest saw.

    Keyed by (scheme_code, aum_quarter) in the store, so re-ingesting the same AMFI
    quarter adds nothing; a scheme with no reported AUM this run contributes no row
    rather than a null placeholder.
    """
    has_quarter = incoming["aum_quarter"].notna() & (
        incoming["aum_quarter"].astype(str).str.strip() != ""
    )
    subset = incoming.loc[has_quarter, ["scheme_code", "aum_quarter", "aum_date", "latest_aum"]]
    if subset.empty:
        return 0
    rows = cast("list[dict[str, Any]]", subset.to_dict("records"))
    with connect(settings) as con:
        init_schema(con)
        return append_aum_history_rows(con, rows)
