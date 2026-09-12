"""Benchmark subsystem: CSV import, index-fund proxies and sub-category mapping."""

from __future__ import annotations

from collections.abc import Callable
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Final

import pandas as pd
import yaml

from ..config import BASE_CURRENCY, Settings, get_settings
from ..db import connect, init_schema
from ..logging_setup import get_logger, log_event
from .benchmark_csv import MIN_USEFUL_MONTHS, BenchmarkCsvError, read_and_validate

__all__ = [
    "BenchmarkCsvError",
    "apply_mapping",
    "build_index_fund_proxy",
    "coverage_report",
    "import_csv",
    "load_mapping_config",
    "validate_csv",
]

logger = get_logger(__name__)


def _monthly_from_index(df: pd.DataFrame, tolerance_days: int | None = None) -> pd.DataFrame:
    """Month-end index level and its monthly return, per benchmark.

    Same completeness rule as NAV: a month whose last observation lands more than
    `tolerance_days` before the month end is not a month-end observation, so the
    running month never enters the series and never faces a full fund month.
    """
    tol = (
        tolerance_days if tolerance_days is not None else get_settings().mf_month_end_tolerance_days
    )
    df = df.copy()
    df["date"] = pd.to_datetime(df["date"])
    df = df.sort_values(["benchmark_id", "date"])
    month_end = (
        df.groupby(["benchmark_id", df["date"].dt.to_period("M")], as_index=False).tail(1).copy()
    )
    label = month_end["date"].dt.to_period("M").dt.to_timestamp("M")
    month_end = month_end[(label - month_end["date"]).dt.days <= tol].copy()
    month_end["date"] = month_end["date"].dt.to_period("M").dt.to_timestamp("M").dt.date
    month_end["monthly_return"] = month_end.groupby("benchmark_id")[
        "price_or_total_return_index"
    ].pct_change()
    return month_end


def validate_csv(path: Path) -> dict[str, Any]:
    """Check a benchmark CSV against the contract without writing anything."""
    _, report = read_and_validate(path)
    return report.to_dict()


def import_csv(path: Path, settings: Settings | None = None) -> dict[str, Any]:
    """Validate a benchmark index CSV and load its month-end series.

    Nothing is written unless the whole file passes: a partially imported index is
    worse than none, because the gap is invisible once the rows are in the table.
    """
    s = settings or get_settings()
    df, report = read_and_validate(path)
    monthly = _monthly_from_index(df, s.mf_month_end_tolerance_days)
    info = _upsert(monthly, s, kind=f"csv:{path.name}")
    counts = monthly.groupby("benchmark_id").size().to_dict()
    thin = [
        f"{entry.benchmark_id} has {int(counts.get(entry.benchmark_id, 0))} month-end "
        f"observations; {MIN_USEFUL_MONTHS} are needed before any risk metric is computed"
        for entry in report.series
        if int(counts.get(entry.benchmark_id, 0)) < MIN_USEFUL_MONTHS
    ]
    return {**report.to_dict(), **info, "warnings": [*report.warnings, *thin]}


def build_index_fund_proxy(
    scheme_code: str,
    benchmark_id: str,
    benchmark_name: str,
    asset_class: str = "Equity",
    settings: Settings | None = None,
) -> dict[str, Any]:
    """Derive a benchmark series from an index fund's NAV.

    This is a PROXY, not the index: it is net of that fund's expenses and tracking
    error. Rows are stamped `index_fund_proxy` so the UI can label them honestly.

    The series is always in rupees, with no way to say otherwise: it comes from an AMFI
    NAV, and even a fund tracking a US index files that NAV in rupees, having already
    absorbed the exchange rate its investors actually bore.
    """
    s = settings or get_settings()
    with connect(s) as con:
        init_schema(con)
        nav = con.execute(
            "SELECT date, nav FROM nav_daily WHERE scheme_code = ? ORDER BY date", [scheme_code]
        ).fetch_df()
    if nav.empty:
        raise ValueError(f"No NAV rows for scheme {scheme_code}; cannot build a proxy benchmark")
    nav = nav.rename(columns={"nav": "price_or_total_return_index"})
    nav["benchmark_id"] = benchmark_id
    nav["benchmark_name"] = benchmark_name
    nav["asset_class"] = asset_class
    nav["currency"] = BASE_CURRENCY
    nav["source"] = f"index_fund_proxy:{scheme_code}"
    return _upsert(
        _monthly_from_index(nav, s.mf_month_end_tolerance_days),
        s,
        kind=f"proxy:{scheme_code}",
    )


def _upsert(monthly: pd.DataFrame, settings: Settings, kind: str) -> dict[str, Any]:
    cols = [
        "benchmark_id",
        "benchmark_name",
        "asset_class",
        "currency",
        "source",
        "date",
        "price_or_total_return_index",
        "monthly_return",
    ]
    out = monthly.loc[:, cols]
    with connect(settings) as con:
        init_schema(con)
        con.register("bm_new", out)
        con.execute(
            "DELETE FROM benchmarks WHERE benchmark_id IN "
            "(SELECT DISTINCT benchmark_id FROM bm_new)"
        )
        con.execute(f"INSERT INTO benchmarks SELECT {', '.join(cols)} FROM bm_new")
        con.unregister("bm_new")
    info = {"kind": kind, "benchmarks": sorted(out["benchmark_id"].unique()), "rows": len(out)}
    log_event(logger, "benchmark.imported", **info)
    return info


def load_mapping_config(settings: Settings | None = None) -> dict[str, Any]:
    s = settings or get_settings()
    return yaml.safe_load(Path(s.benchmark_map_path).read_text())


def apply_mapping(settings: Settings | None = None) -> dict[str, Any]:
    """Map every scheme to a benchmark by sub-category, honouring configured fallbacks."""
    s = settings or get_settings()
    config = load_mapping_config(s)
    rules: list[dict[str, Any]] = config["mappings"]
    with connect(s) as con:
        init_schema(con)
        master = con.execute(
            "SELECT scheme_code, clean_sub_category, scheme_name FROM scheme_master"
        ).fetch_df()
        loaded = con.execute(
            "SELECT benchmark_id, any_value(currency) AS currency FROM benchmarks "
            "GROUP BY benchmark_id"
        ).fetch_df()
        currency_of: dict[str, str] = dict(
            zip(loaded["benchmark_id"].astype(str), loaded["currency"].astype(str), strict=True)
        )

        rows: list[dict[str, Any]] = []
        for rec in master.to_dict("records"):
            sub = str(rec["clean_sub_category"] or "")
            name = str(rec["scheme_name"] or "")
            rule = next(
                (
                    r
                    for r in rules
                    if any(m.lower() in sub.lower() for m in r.get("sub_category_contains", []))
                    or any(m.lower() in name.lower() for m in r.get("scheme_name_contains", []))
                ),
                None,
            )
            if rule is None:
                continue
            candidates = [
                b
                for b in (rule["benchmark_id"], *rule.get("fallback_benchmark_ids", []))
                if b in currency_of
            ]
            # An INR series always wins, wherever it sits in the configured order: a
            # foreign-currency benchmark yields no benchmark-relative metrics at all.
            chosen = next(
                (b for b in candidates if currency_of[b] == BASE_CURRENCY),
                candidates[0] if candidates else None,
            )
            if chosen is None:
                continue
            mismatched = currency_of[chosen] != BASE_CURRENCY
            rows.append(
                {
                    "scheme_code": rec["scheme_code"],
                    "benchmark_id": chosen,
                    "source_type": "config_sub_category_map",
                    "confidence": (
                        "currency_mismatch"
                        if mismatched
                        else ("high" if chosen == rule["benchmark_id"] else "fallback")
                    ),
                    "effective_from": None,
                    "effective_to": None,
                    "notes": rule.get("notes"),
                }
            )
        con.execute("DELETE FROM scheme_benchmark_map")
        if rows:
            frame = pd.DataFrame(rows)
            frame["effective_from"] = pd.to_datetime(frame["effective_from"]).dt.date
            frame["effective_to"] = pd.to_datetime(frame["effective_to"]).dt.date
            con.register("map_new", frame)
            con.execute(
                "INSERT INTO scheme_benchmark_map SELECT scheme_code, benchmark_id, source_type, "
                "confidence, effective_from, effective_to, notes FROM map_new"
            )
            con.unregister("map_new")
    info = {
        "mapped_schemes": len(rows),
        "available_benchmarks": sorted(currency_of),
        "currency_mismatched_schemes": sum(
            1 for r in rows if r["confidence"] == "currency_mismatch"
        ),
        "mapped_at": datetime.now(UTC).isoformat(),
    }
    log_event(logger, "benchmark.mapped", **info)
    return info


def coverage_report(fetch: Callable[[str], pd.DataFrame]) -> dict[str, Any]:
    """What each loaded benchmark covers, and every way that coverage falls short.

    Takes a query callable rather than opening its own connection: the CLI reads
    through the write connection it already holds and the API through its shared
    read-only one, and both get warnings worded once, here.
    """
    series = fetch(
        "SELECT b.benchmark_id, any_value(b.benchmark_name) AS benchmark_name, "
        "any_value(b.currency) AS currency, any_value(b.source) AS source, "
        "any_value(b.asset_class) AS asset_class, min(b.date) AS first_date, "
        "max(b.date) AS last_date, count(*) AS months, "
        "(SELECT count(*) FROM scheme_benchmark_map m WHERE m.benchmark_id = b.benchmark_id) "
        "AS mapped_schemes FROM benchmarks b GROUP BY b.benchmark_id ORDER BY b.benchmark_id"
    )
    unmapped = fetch(
        "SELECT clean_sub_category, count(*) AS schemes FROM scheme_master m "
        "WHERE NOT EXISTS (SELECT 1 FROM scheme_benchmark_map b "
        "WHERE b.scheme_code = m.scheme_code) "
        "GROUP BY 1 ORDER BY schemes DESC"
    )
    total_schemes = int(fetch("SELECT count(*) AS n FROM scheme_master")["n"].iloc[0])

    entries: list[dict[str, Any]] = []
    warnings: list[str] = []
    for rec in series.to_dict("records"):
        currency = str(rec["currency"])
        comparable = currency == BASE_CURRENCY
        months = int(rec["months"])
        is_proxy = str(rec["source"]).startswith("index_fund_proxy")
        entries.append(
            {
                "benchmark_id": str(rec["benchmark_id"]),
                "benchmark_name": str(rec["benchmark_name"]),
                "currency": currency,
                "source": str(rec["source"]),
                "asset_class": str(rec["asset_class"]),
                "first_date": str(pd.Timestamp(rec["first_date"]).date()),
                "last_date": str(pd.Timestamp(rec["last_date"]).date()),
                "months": months,
                "mapped_schemes": int(rec["mapped_schemes"]),
                "is_proxy": is_proxy,
                "comparable_with_inr_funds": comparable,
            }
        )
        if not comparable:
            warnings.append(
                f"{rec['benchmark_id']} is a {currency} series and {int(rec['mapped_schemes'])} "
                f"scheme(s) map to it. Alpha, beta, tracking error and the benchmark "
                f"information ratio are withheld for those schemes: the difference between "
                f"a {currency} index and a NAV published in {BASE_CURRENCY} would include "
                "the exchange rate."
            )
        elif months < MIN_USEFUL_MONTHS:
            warnings.append(
                f"{rec['benchmark_id']} has {months} month-end observations, fewer than the "
                f"{MIN_USEFUL_MONTHS} needed for a 3-year risk metric."
            )
        if is_proxy:
            warnings.append(
                f"{rec['benchmark_id']} is an index-fund proxy, not the index: it is net of "
                "that fund's expenses and tracking error, so it understates the benchmark "
                "and flatters every fund measured against it."
            )

    mapped = int(series["mapped_schemes"].sum()) if len(series) else 0
    unmapped_total = int(unmapped["schemes"].sum()) if len(unmapped) else 0
    if unmapped_total:
        biggest = ", ".join(
            f"{r['clean_sub_category']} ({int(r['schemes'])})"
            for r in unmapped.head(3).to_dict("records")
        )
        warnings.append(
            f"{unmapped_total:,} of {total_schemes:,} schemes have no benchmark mapped, so "
            "their benchmark-relative metrics are null with reason 'benchmark_not_mapped'. "
            f"Largest unmapped sub-categories: {biggest}. Add a rule to benchmark_map.yaml "
            "and import the matching index to cover them."
        )
    if not len(series):
        warnings.append(
            "No benchmark series loaded, so alpha, beta, tracking error and the benchmark "
            "information ratio are unavailable for every scheme. Import one with "
            "`make benchmark-import FILE=...`."
        )
    info = {
        "benchmarks": entries,
        "schemes_total": total_schemes,
        "schemes_mapped": mapped,
        "schemes_unmapped": unmapped_total,
        "unmapped_by_sub_category": unmapped.head(20).to_dict("records"),
        "warnings": warnings,
    }
    log_event(
        logger,
        "benchmark.coverage",
        benchmarks=len(entries),
        schemes_mapped=mapped,
        schemes_unmapped=unmapped_total,
        warnings=len(warnings),
    )
    return info


# The basis for returns-based style analysis. Every entry is an index fund already in the
# NAV data, chosen as the longest-running Direct-Growth tracker of its index, because the
# fit window is bounded by the shortest series in the basis.
#
# Momentum and Value are deliberately absent. The Nifty 500 Momentum 50 and Value 50
# trackers began in 2023-24, and adding either would cut the shared window below the
# 24 months every other risk metric in this app requires.
STYLE_FACTOR_CLASS: Final = "Style Factor"
STYLE_BASIS: Final[tuple[tuple[str, str, str], ...]] = (
    ("118581", "NIFTY50_PROXY", "Nifty 50 (large cap)"),
    ("148726", "NIFTY_MIDCAP150_PROXY", "Nifty Midcap 150"),
    ("148519", "NIFTY_SMALLCAP250_PROXY", "Nifty Smallcap 250"),
    ("149254", "NIFTY100_QUALITY30_PROXY", "Nifty 100 Quality 30"),
    ("149804", "NIFTY_BANK_PROXY", "Nifty Bank"),
    ("150468", "NIFTY_IT_PROXY", "Nifty IT"),
    ("150930", "NIFTY_PHARMA_PROXY", "Nifty Pharma"),
)


def build_style_basis(settings: Settings | None = None) -> list[dict[str, Any]]:
    """Build every style-factor proxy, so the basis is reproducible from one command."""
    return [
        build_index_fund_proxy(
            code, benchmark_id, name, asset_class=STYLE_FACTOR_CLASS, settings=settings
        )
        for code, benchmark_id, name in STYLE_BASIS
    ]
