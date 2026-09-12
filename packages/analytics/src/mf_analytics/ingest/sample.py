"""Development sample: a few dozen representative schemes with full NAV history.

Small enough to run tests and the UI without the 170 MB full history download.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

import pandas as pd

from ..classify import OPT_GROWTH, PLAN_DIRECT
from ..config import Settings, get_settings
from ..db import connect, init_schema, record_ingest
from ..logging_setup import get_logger, log_event
from ..sources.tigzig import TigZigSource
from .master import CANONICAL_COLUMNS, load_master, normalise_master
from .nav import refresh_monthly_tables, write_nav_dataset

logger = get_logger(__name__)

SAMPLE_SUB_CATEGORIES = [
    "Mid Cap Fund",
    "Small Cap Fund",
    "Flexi Cap Fund",
    "Large Cap Fund",
    "Value Fund",
    "Multi Cap Fund",
    "Index Funds",
]
PER_SUB_CATEGORY = 8


def choose_sample(master: pd.DataFrame, per_sub_category: int = PER_SUB_CATEGORY) -> pd.DataFrame:
    """Longest-history Direct Growth funds per sub-category, plus their plan/option twins.

    The twins exist so universe filters (Direct vs Regular, Growth vs IDCW) have
    something to exclude in local development, rather than silently passing.
    """
    active = master[master["is_active"].astype("boolean").fillna(False)]
    core = active[(active["clean_plan"] == PLAN_DIRECT) & (active["clean_option"] == OPT_GROWTH)]
    picks: list[pd.DataFrame] = []
    for sub in SAMPLE_SUB_CATEGORIES:
        rows = core[core["clean_sub_category"] == sub].sort_values("first_nav_date")
        picks.append(rows.head(per_sub_category))
    sp500 = active[active["scheme_name"].str.contains("S&P 500", case=False, na=False)].head(4)
    picks.append(sp500)

    chosen = pd.concat(picks).drop_duplicates(subset=["scheme_code"])
    amcs = chosen["amc"].dropna().unique()[:3]
    twins = active[
        active["amc"].isin(amcs)
        & active["clean_sub_category"].isin(SAMPLE_SUB_CATEGORIES)
        & ((active["clean_plan"] != PLAN_DIRECT) | (active["clean_option"] != OPT_GROWTH))
    ].head(8)
    matured = master[~master["is_active"].astype("boolean").fillna(False)]
    matured = (
        matured[matured["clean_sub_category"].isin(SAMPLE_SUB_CATEGORIES)]
        .sort_values("last_nav_date", ascending=False)
        .head(4)
    )
    return pd.concat([chosen, twins, matured]).drop_duplicates(subset=["scheme_code"])


def run(
    per_sub_category: int = PER_SUB_CATEGORY,
    settings: Settings | None = None,
    run_id: str | None = None,
) -> dict[str, Any]:
    s = settings or get_settings()
    s.ensure_dirs()
    started = datetime.now(UTC).replace(tzinfo=None)
    rid = run_id or started.strftime("%Y%m%dT%H%M%S")
    source = TigZigSource(s)

    dest = s.raw_dir / f"scheme_master.{s.mf_master_format}"
    meta = source.fetch_master(dest)
    full_master = normalise_master(source.read_master(dest), source.name)
    sample_master = choose_sample(full_master, per_sub_category)
    codes = sample_master["scheme_code"].tolist()
    print(f"Fetching NAV history for {len(codes)} sample schemes...")
    nav = source.fetch_many_nav(codes)
    if nav.empty:
        raise RuntimeError("Sample NAV download returned no rows")

    load_master(sample_master.loc[:, CANONICAL_COLUMNS], s)
    with connect(s) as con:
        init_schema(con)
        con.register("nav_sample", nav.loc[:, ["scheme_code", "date", "nav"]])
        rows = write_nav_dataset(
            con, "SELECT scheme_code, date, nav, 0 AS priority FROM nav_sample", s
        )
        con.unregister("nav_sample")
        n_monthly, n_returns = refresh_monthly_tables(con)
        info = {
            "mode": "sample",
            "schemes": len(codes),
            "nav_rows": rows,
            "nav_monthly_rows": n_monthly,
            "monthly_return_rows": n_returns,
            "source_url": meta.get("url"),
        }
        record_ingest(con, rid, "data-sample", started, "ok", row_count=rows, details=info)
    log_event(logger, "sample.loaded", **info)
    return info
