"""FastAPI application for the mutual fund screener."""

from __future__ import annotations

import io
import json
import re
import subprocess
import sys
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from datetime import date
from pathlib import Path
from typing import Annotated, Any, Final, Literal, cast

import numpy as np
import pandas as pd
from fastapi import Body, FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel, Field, field_validator, model_validator

from mf_analytics.config import BASE_CURRENCY, TRAILING_HORIZONS, get_settings
from mf_analytics.db import StoreLockedError
from mf_analytics.enrich import attributes as scheme_attributes
from mf_analytics.enrich import holdings, is_stale
from mf_analytics.ingest import benchmarks as benchmark_ingest
from mf_analytics.ingest.benchmarks import STYLE_FACTOR_CLASS
from mf_analytics.logging_setup import configure_logging
from mf_analytics.metrics import tax as tax_metrics
from mf_analytics.metrics.basket import MIN_OBS as BASKET_MIN_OBS
from mf_analytics.metrics.basket import compute_basket, matched_returns
from mf_analytics.metrics.exposure import (
    ROLLING_WINDOW_MONTHS,
    Exposure,
    rolling_style_exposure,
    style_drift,
    style_exposure,
)
from mf_analytics.metrics.risk import drawdown_episodes
from mf_analytics.metrics.series import (
    calendar_year_returns,
    comparable_grid,
    rolling_cagr,
    summarise_rolling,
    trailing_cagr,
)
from mf_analytics.pipeline import CAPTURE_HORIZONS
from mf_analytics.quality import Reason, all_reason_descriptions
from mf_analytics.scoring import COMPONENTS, HORIZONS, ScoreResult, score_fund
from mf_analytics.universe import (
    DEFAULT_UNIVERSE,
    PeerUniverse,
    counterpart_category_key,
    is_active_only_key,
)

from .columns import DEFAULT_COLUMNS, NUMERIC_BY_NAME, SELECTABLE, SORTABLE, STARTER_COLUMNS
from .methodology import methodology_document
from .presets import PRESETS, PRESETS_BY_ID
from .screen import (
    FilterError,
    ScreenRequest,
    parse_columns,
    parse_ranges,
    parse_sort,
    run_export,
    run_screen,
)
from .store import close_connection, query_df, query_optional, query_scalar

configure_logging()
settings = get_settings()

DISCLAIMER = (
    "Analytics and research only. Not investment advice. "
    "Historical returns do not guarantee future returns."
)

# Every reason the app can emit, resolved through one lookup. Composed in quality.py
# rather than here, so a module that adds a reason reaches every consumer at once
# instead of only the merge whose author remembered it.
_REASON_DESCRIPTIONS = all_reason_descriptions()


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    yield
    close_connection()


app = FastAPI(
    lifespan=lifespan,
    title="Indian Mutual Fund Screener API",
    version="0.1.0",
    description=(
        "Local-first screener over AMFI NAV data. Every metric is computed from stored "
        "snapshots and every missing value carries a reason.\n\n" + DISCLAIMER
    ),
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in settings.mf_cors_origins.split(",") if o.strip()],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(StoreLockedError)
def _store_locked(_: Request, exc: StoreLockedError) -> JSONResponse:
    """A rebuild in progress is a wait, not a fault: say so and let the client retry."""
    return JSONResponse(
        status_code=503, content={"detail": str(exc)}, headers={"Retry-After": "30"}
    )


def _clean_records(frame: pd.DataFrame) -> list[dict[str, Any]]:
    """NaN/NaT -> null, so a missing metric is explicit JSON null, never a string."""
    out = frame.replace({np.nan: None}).astype(object).where(pd.notna(frame), None)
    records = cast(list[dict[str, Any]], out.to_dict("records"))
    for row in records:
        for key, value in row.items():
            if isinstance(value, pd.Timestamp):
                # DuckDB DATE columns arrive as midnight timestamps. Render those as a
                # plain date; keep the clock on anything that actually carries a time.
                row[key] = (
                    value.date().isoformat()
                    if value == value.normalize()
                    else value.isoformat(sep=" ", timespec="seconds")
                )
            elif isinstance(value, date):
                row[key] = value.isoformat()
            elif key in {"data_quality_flags", "missing_reasons"} and isinstance(value, str):
                row[key] = json.loads(value)
    return records


@app.get("/health", tags=["meta"])
def health() -> dict[str, Any]:
    return {
        "status": "ok",
        "schemes": int(query_scalar("SELECT count(*) FROM scheme_master")),
        "disclaimer": DISCLAIMER,
    }


@app.get("/metadata", tags=["meta"])
def metadata() -> dict[str, Any]:
    counts = {
        # the table names come from this literal tuple, never from a request
        name: int(query_scalar(f"SELECT count(*) FROM {name}"))
        for name in (
            "scheme_master",
            "nav_daily",
            "nav_monthly",
            "monthly_returns",
            "rolling_returns_monthly",
            "benchmarks",
            "scheme_benchmark_map",
            "scheme_metrics_snapshot",
        )
    }
    # T2.1: the number of economic funds, as against the number of scheme codes. Direct
    # and Regular, Growth and IDCW are separate codes for one fund, so the raw row count
    # overstates how much there is to choose from. A code with no family stays its own.
    counts["fund_families"] = int(
        query_scalar(
            "SELECT count(DISTINCT coalesce(fund_family_id, scheme_code)) FROM scheme_master"
        )
    )
    coverage = query_df(
        "SELECT min(first_nav_date) AS first_nav_date, max(last_nav_date) AS last_nav_date, "
        "max(latest_nav_date) AS latest_nav_date FROM scheme_master"
    )
    as_of = query_scalar("SELECT max(as_of_date) FROM scheme_metrics_snapshot")
    log = query_df(
        "SELECT run_id, step, started_at, finished_at, status, row_count, source_url "
        "FROM ingest_log ORDER BY started_at DESC LIMIT 20"
    )
    bench = query_df(
        "SELECT benchmark_id, any_value(benchmark_name) AS benchmark_name, "
        "any_value(currency) AS currency, "
        "any_value(source) AS source, min(date) AS first_date, max(date) AS last_date, "
        "count(*) AS months FROM benchmarks GROUP BY benchmark_id ORDER BY benchmark_id"
    )
    return {
        "counts": counts,
        "coverage": {**_clean_records(coverage)[0], "metrics_as_of": str(as_of) if as_of else None},
        "benchmarks": _clean_records(bench),
        "ingest_log": _clean_records(log),
        "methodology_version": settings.mf_methodology_version,
        "default_universe": DEFAULT_UNIVERSE.model_dump(),
        "disclaimer": DISCLAIMER,
    }


@app.get("/methodology", tags=["meta"])
def methodology() -> dict[str, Any]:
    return methodology_document(settings)


@app.get("/presets", tags=["meta"])
def presets() -> list[dict[str, Any]]:
    # The names used to begin "A." to "E.", which ordered them wherever they were
    # rendered. They no longer do, so the order has to be stated rather than spelled.
    return sorted(PRESETS, key=lambda p: p["order"])


@app.get("/columns", tags=["meta"])
def columns() -> dict[str, Any]:
    return {
        "default": list(DEFAULT_COLUMNS),
        "starter": list(STARTER_COLUMNS),
        "selectable": sorted(SELECTABLE),
        "sortable": sorted(SORTABLE),
        "metrics": [c.as_dict() for c in NUMERIC_BY_NAME.values()],
        "missing_reasons": _REASON_DESCRIPTIONS,
    }


_SEARCH_WORD_RE = re.compile(r"[a-z0-9]+")

# A query containing any of these is asking for a particular plan or option, so the
# default "lead with Direct Growth" preference is dropped and relevance decides.
_VARIANT_WORDS: Final = frozenset(
    {"direct", "regular", "growth", "idcw", "dividend", "payout", "reinvestment", "bonus"}
)


@app.get("/search", tags=["schemes"])
def search(
    q: Annotated[str, Query(min_length=1, max_length=200)],
    limit: Annotated[int, Query(ge=1, le=25)] = 10,
) -> dict[str, Any]:
    """Typeahead over scheme name and AMC, backed by the fts index built at schema init.

    Deliberately ungrouped: every plan/option variant is its own row here, carrying
    plan and option, so typing "Regular" finds the Regular row rather than only the
    Direct Growth row the default (T2.1-grouped) universe would otherwise show alone.
    """
    words = _SEARCH_WORD_RE.findall(q.lower())
    if not words:
        return {"query": q, "items": []}

    # Relevance alone interleaves one fund's variants and orders them arbitrarily, so
    # "parag parikh flexi" led with the two IDCW plans. Rank whole funds by their best
    # matching variant, keep each fund's variants together, and lead with Direct Growth
    # - unless the query names a plan or option, in which case the user asked for a
    # specific variant and pure relevance is the right answer.
    variant_named = bool(_VARIANT_WORDS & set(words))
    variant_order = (
        ""
        if variant_named
        else """(clean_plan = 'Direct' AND clean_option = 'Growth') DESC,
                 (clean_plan = 'Direct') DESC,
                 (clean_option = 'Growth') DESC,"""
    )
    rows = query_df(
        f"""
        WITH matched AS (
            SELECT scheme_code, scheme_name, amc, clean_sub_category, clean_plan, clean_option,
                   coalesce(fund_family_id, scheme_code) AS family,
                   fts_main_scheme_master.match_bm25(scheme_code, ?) AS score
            FROM scheme_master
            WHERE score IS NOT NULL
        )
        SELECT scheme_code, scheme_name, amc, clean_sub_category, clean_plan, clean_option
        FROM (SELECT *, max(score) OVER (PARTITION BY family) AS family_score FROM matched)
        ORDER BY family_score DESC, family, {variant_order} score DESC, scheme_name
        LIMIT ?
        """,
        [" ".join(words), limit],
    )
    return {"query": q, "items": _clean_records(rows)}


@app.get("/schemes", tags=["schemes"])
def schemes(
    q: str | None = None,
    sub_category: str | None = None,
    amc: str | None = None,
    limit: Annotated[int, Query(ge=1, le=500)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> dict[str, Any]:
    clauses: list[str] = []
    params: list[Any] = []
    if q:
        clauses.append("(lower(scheme_name) LIKE ? OR lower(amc) LIKE ? OR scheme_code LIKE ?)")
        params += [f"%{q.lower()}%", f"%{q.lower()}%", f"%{q}%"]
    if sub_category:
        clauses.append("clean_sub_category = ?")
        params.append(sub_category)
    if amc:
        clauses.append("amc = ?")
        params.append(amc)
    where = " WHERE " + " AND ".join(clauses) if clauses else ""
    total = int(query_scalar(f"SELECT count(*) FROM scheme_master{where}", params))
    rows = query_df(
        "SELECT scheme_code, scheme_name, amc, clean_category, clean_sub_category, clean_plan, "
        "clean_option, isin_growth, isin_dividend, is_active, first_nav_date, last_nav_date, "
        "latest_nav, latest_nav_date, latest_aum, aum_quarter, fund_age_years, fund_family_id, "
        # A correlated read rather than a join: the filter clauses below are shared with
        # the count query, and a second table would make `scheme_code` ambiguous in them.
        "(SELECT t.expense_ratio FROM scheme_ter t WHERE t.scheme_code = "
        "scheme_master.scheme_code) AS expense_ratio "
        f"FROM scheme_master{where} ORDER BY scheme_name LIMIT ? OFFSET ?",
        [*params, limit, offset],
    )
    return {"total": total, "limit": limit, "offset": offset, "items": _clean_records(rows)}


def _scheme_or_404(scheme_code: str) -> dict[str, Any]:
    rows = query_df(
        "SELECT m.*, t.expense_ratio FROM scheme_master m "
        "LEFT JOIN scheme_ter t USING (scheme_code) WHERE m.scheme_code = ?",
        [scheme_code],
    )
    if rows.empty:
        raise HTTPException(status_code=404, detail=f"Unknown scheme_code {scheme_code!r}")
    return _clean_records(rows)[0]


def _metrics_unavailable(scheme_code: str) -> dict[str, str] | None:
    """Why a known scheme has no metrics row, from the evidence ingestion already stored.

    A scheme can be in the master and still be uncomputable - AMFI lists matured schemes
    whose whole published history is the terminal 0.00 marker. Saying which of those it is
    matters: three of the four reasons no rebuild can fix, and the fourth names the command
    that does.
    """
    if query_scalar(
        "SELECT count(*) FROM scheme_metrics_snapshot WHERE scheme_code = ?", [scheme_code]
    ):
        return None
    month_ends = int(
        query_scalar("SELECT count(*) FROM nav_monthly WHERE scheme_code = ?", [scheme_code])
    )
    if month_ends >= 2:
        reason = Reason.SNAPSHOT_STALE
    elif int(query_scalar("SELECT count(*) FROM nav_daily WHERE scheme_code = ?", [scheme_code])):
        reason = Reason.TOO_FEW_MONTH_ENDS
    elif int(
        query_scalar(
            "SELECT coalesce(sum(excluded_rows), 0) FROM nav_zero_excluded WHERE scheme_code = ?",
            [scheme_code],
        )
    ):
        reason = Reason.ALL_NAVS_NON_POSITIVE
    else:
        reason = Reason.NO_NAV_HISTORY
    return {"reason": reason, "description": _REASON_DESCRIPTIONS[reason]}


@app.get("/schemes/{scheme_code}", tags=["schemes"])
def scheme_detail(scheme_code: str) -> dict[str, Any]:
    scheme = _scheme_or_404(scheme_code)
    mapping = query_df(
        "SELECT b.benchmark_id, any_value(b.benchmark_name) AS benchmark_name, "
        "any_value(b.currency) AS currency, any_value(b.source) AS source, "
        "any_value(m.confidence) AS confidence, any_value(m.notes) AS notes "
        "FROM scheme_benchmark_map m JOIN benchmarks b USING (benchmark_id) "
        "WHERE m.scheme_code = ? GROUP BY b.benchmark_id",
        [scheme_code],
    )
    benchmark = _clean_records(mapping)[0] if not mapping.empty else None
    if benchmark is not None:
        # The UI must never have to infer comparability from a currency string.
        benchmark["comparable_with_inr_funds"] = benchmark["currency"] == BASE_CURRENCY
        benchmark["fund_currency"] = BASE_CURRENCY
    return {
        "scheme": scheme,
        "benchmark": benchmark,
        # Null for a fund with metrics. Set, it lets the fund page explain the gap in
        # place instead of failing on the metrics request behind it.
        "metrics_unavailable": _metrics_unavailable(scheme_code),
        # T2.2: when this is non-empty, every peer-relative figure on the page spans a
        # period in which the fund changed peer group, so the comparison changes meaning
        # part-way through. The page has to say so rather than let the reader assume one
        # peer group throughout.
        "category_history": _category_history(scheme_code),
        "disclaimer": DISCLAIMER,
    }


def _category_history(scheme_code: str) -> list[dict[str, Any]]:
    """Every recorded category this scheme has sat in, oldest first.

    One row means the category has never been observed to change and the page says
    nothing. Two or more is what the fund page warns about.
    """
    rows = query_df(
        "SELECT clean_category, clean_sub_category, valid_from, valid_to "
        "FROM scheme_category_history WHERE scheme_code = ? ORDER BY valid_from",
        [scheme_code],
    )
    return _clean_records(rows) if not rows.empty else []


@app.get("/schemes/{scheme_code}/variants", tags=["schemes"])
def scheme_variants(scheme_code: str) -> dict[str, Any]:
    """The fund's other plan/option variants (T2.1): rows sharing its fund_family_id,
    excluding itself, so the fund page can link to the Regular or IDCW twin of the
    Direct Growth row the screener otherwise shows alone."""
    scheme = _scheme_or_404(scheme_code)
    family_id = scheme.get("fund_family_id")
    if family_id is None:
        return {"fund_family_id": None, "items": []}
    rows = query_df(
        "SELECT scheme_code, scheme_name, clean_plan, clean_option, is_active, latest_aum, "
        "(SELECT t.expense_ratio FROM scheme_ter t WHERE t.scheme_code = "
        "scheme_master.scheme_code) AS expense_ratio "
        "FROM scheme_master WHERE fund_family_id = ? AND scheme_code != ? "
        "ORDER BY scheme_name",
        [family_id, scheme_code],
    )
    return {"fund_family_id": family_id, "items": _clean_records(rows)}


def _attribute_out(enriched: Any) -> dict[str, Any]:
    value = enriched.value
    if isinstance(value, date):
        value = value.isoformat()
    as_of = enriched.as_of.isoformat() if isinstance(enriched.as_of, date) else enriched.as_of
    reason_description = _REASON_DESCRIPTIONS.get(enriched.reason) if enriched.reason else None
    return {
        "value": value,
        "as_of": as_of,
        "stale": enriched.stale,
        "reason": enriched.reason,
        "reason_description": reason_description,
    }


@app.get("/schemes/{scheme_code}/attributes", tags=["schemes"])
def scheme_attributes_detail(scheme_code: str) -> dict[str, Any]:
    """Riskometer, exit load, lock-in, minimums, SID benchmark, fund manager and
    tenure (T3.2). Third-party per `docs/data-policy.md`: never a return, risk or
    ranking input, so this is its own endpoint rather than a `/schemes/{code}` field.
    """
    _scheme_or_404(scheme_code)
    rows = query_df(
        f"SELECT * FROM {scheme_attributes.TABLE.name} WHERE scheme_code = ?", [scheme_code]
    )
    row: dict[str, Any] | None = None
    if not rows.empty:
        # `_clean_records` would stringify the date columns `resolve` needs to do
        # arithmetic on, so NaN->None is applied by hand instead, dates left native.
        cleaned = rows.replace({np.nan: None}).astype(object).where(pd.notna(rows), None)
        row = cast(dict[str, Any], cleaned.iloc[0].to_dict())
        for key in ("riskometer_as_of", "manager_start_date", "as_of"):
            value = row.get(key)
            if isinstance(value, pd.Timestamp):
                row[key] = value.date()
    resolved = scheme_attributes.resolve(row, date.today())
    fields = {name: _attribute_out(resolved[name]) for name in scheme_attributes.DISPLAY_FIELDS}
    return {
        "scheme_code": scheme_code,
        "fields": fields,
        "source": (row or {}).get("source") or scheme_attributes.SOURCE_NAME,
        "source_url": (row or {}).get("source_url"),
        "disclaimer": DISCLAIMER,
    }


@app.get("/schemes/{scheme_code}/nav", tags=["schemes"])
def scheme_nav(
    scheme_code: str,
    frequency: Annotated[str, Query(pattern="^(daily|monthly)$")] = "daily",
    since: str | None = None,
) -> dict[str, Any]:
    _scheme_or_404(scheme_code)
    table = "nav_daily" if frequency == "daily" else "nav_monthly"
    params: list[Any] = [scheme_code]
    clause = ""
    if since:
        clause = " AND date >= ?"
        params.append(since)
    rows = query_df(
        f"SELECT date, nav FROM {table} WHERE scheme_code = ?{clause} ORDER BY date", params
    )
    return {"scheme_code": scheme_code, "frequency": frequency, "points": _clean_records(rows)}


@app.get("/schemes/{scheme_code}/monthly-returns", tags=["schemes"])
def scheme_monthly_returns(scheme_code: str) -> dict[str, Any]:
    """The stored monthly returns /basket blends, which a rounded NAV cannot reproduce.

    Two aligned columns rather than a list of points: the static export ships one of
    these per fund, and repeating the keys would double its size.
    """
    _scheme_or_404(scheme_code)
    rows = _clean_records(
        query_df(
            "SELECT date, monthly_return FROM monthly_returns WHERE scheme_code = ? ORDER BY date",
            [scheme_code],
        )
    )
    return {
        "scheme_code": scheme_code,
        "dates": [r["date"] for r in rows],
        "values": [r["monthly_return"] for r in rows],
    }


@app.get("/schemes/{scheme_code}/metrics", tags=["metrics"])
def scheme_metrics(scheme_code: str) -> dict[str, Any]:
    _scheme_or_404(scheme_code)
    rows = query_df(
        "SELECT * FROM scheme_metrics_snapshot WHERE scheme_code = ? "
        "ORDER BY as_of_date DESC LIMIT 1",
        [scheme_code],
    )
    if rows.empty:
        unavailable = _metrics_unavailable(scheme_code)
        assert unavailable is not None  # no snapshot row is exactly what got us here
        raise HTTPException(status_code=404, detail=unavailable["description"])
    record = _clean_records(rows)[0]
    # Keyed by reason, not by field: `missing_reasons` already maps field -> reason, and
    # a second field-keyed map invited each caller to guess which key this one used.
    record["missing_reason_descriptions"] = {
        reason: _REASON_DESCRIPTIONS.get(reason, reason)
        for reason in (record.get("missing_reasons") or {}).values()
    }
    return record


# Every column the score's components read, gathered from the declared table itself so
# this list can never drift out of step with scoring.COMPONENTS.
_SCORE_COLUMNS: Final[tuple[str, ...]] = tuple(
    sorted(
        {
            metric.column
            for component in COMPONENTS.values()
            for horizon in HORIZONS
            for metric in component.columns(horizon)
        }
    )
)


def _available_score_columns() -> tuple[str, ...]:
    """The score's columns that this store actually has.

    A component whose column has never been computed - a metric added after the last
    rebuild - must read as a missing component, which the score already handles, rather
    than break every /score with an unknown-column error.
    """
    present = set(query_df("SELECT * FROM screen_base LIMIT 0").columns)
    return tuple(c for c in _SCORE_COLUMNS if c in present)


def _score_peer_group(scheme_code: str) -> tuple[str | None, pd.DataFrame]:
    """This scheme's own row plus its active Direct-Growth peers in the same peer group.

    The group is `peer_group`, not the raw sub-category: SEBI files a fund by its legal
    wrapper, which pools a gold fund-of-funds with a Nasdaq feeder. Same definition the
    stored peer-relative metrics use, so "peer" means one thing across the app.
    """
    group = query_optional(
        "SELECT peer_group FROM scheme_master WHERE scheme_code = ?", [scheme_code]
    )
    if not group:
        return None, pd.DataFrame(columns=("scheme_code", *_SCORE_COLUMNS))
    columns_sql = ", ".join(_available_score_columns())
    rows = query_df(
        f"SELECT scheme_code, {columns_sql} FROM screen_base "
        "WHERE peer_group = ? "
        "AND (scheme_code = ? "
        "OR (clean_plan = 'Direct' AND clean_option = 'Growth' AND is_active))",
        [group, scheme_code],
    )
    return str(group), rows


def _score_out(result: ScoreResult) -> dict[str, Any]:
    return {
        "scheme_code": result.scheme_code,
        "total": result.total,
        "status": result.status,
        "missing_components": list(result.missing),
        "coverage": result.coverage,
        "reason": result.reason,
        "reason_description": (
            _REASON_DESCRIPTIONS.get(result.reason, result.reason) if result.reason else None
        ),
        "weights": result.weights,
        "components": {
            name: {
                "weight": result.weights.get(name),
                "percentile": c.percentile,
                "contribution": c.contribution,
                "reason": c.reason,
                "reason_description": (
                    _REASON_DESCRIPTIONS.get(c.reason, c.reason) if c.reason else None
                ),
                "horizons": list(c.horizons),
            }
            for name, c in result.components.items()
        },
    }


@app.get("/score/{scheme_code}", tags=["metrics"])
def scheme_score(scheme_code: str) -> dict[str, Any]:
    """The composite score: a weighted, within-peer-group percentile decomposition.

    A description of the past against a declared weight table - never a rating or a
    recommendation. A fund missing a component is scored on the components it has, with
    the missing ones named; nothing is imputed to a category mean.
    """
    _scheme_or_404(scheme_code)
    group, peers = _score_peer_group(scheme_code)
    if group is None or scheme_code not in set(peers["scheme_code"]):
        unavailable = _metrics_unavailable(scheme_code)
        detail = (
            unavailable["description"] if unavailable else "No metrics snapshot for this scheme."
        )
        raise HTTPException(status_code=404, detail=detail)
    result = score_fund(peers, scheme_code, min_peers=settings.mf_min_peers)
    out = _score_out(result)
    out["peer_group"] = group
    out["peer_count"] = len(peers) - 1
    out["disclaimer"] = DISCLAIMER
    return out


def _monthly_frame(scheme_code: str) -> tuple[pd.DataFrame, pd.Timestamp | None]:
    """The scheme's comparable month-end series, exactly as the stored snapshot saw it."""
    rows = query_df(
        "SELECT date, nav, obs_date FROM nav_monthly WHERE scheme_code = ? ORDER BY date",
        [scheme_code],
    )
    if rows.empty:
        raise HTTPException(status_code=404, detail=f"No NAV history stored for {scheme_code!r}")
    return comparable_grid(rows, settings.mf_nav_jump_ratio)


@app.get("/schemes/{scheme_code}/rolling-returns", tags=["metrics"])
def scheme_rolling(
    scheme_code: str, horizon: Annotated[int, Query(ge=1, le=15)] = 5
) -> dict[str, Any]:
    _scheme_or_404(scheme_code)
    frame, scale_break_at = _monthly_frame(scheme_code)
    series = rolling_cagr(frame, horizon)
    summary = summarise_rolling(series, settings.mf_min_rolling_windows)

    category_key = query_optional(
        "SELECT category_key FROM scheme_metrics_snapshot WHERE scheme_code = ? "
        "ORDER BY as_of_date DESC LIMIT 1",
        [scheme_code],
    )
    category_points: list[dict[str, Any]] = []
    if category_key:
        cat = query_df(
            "SELECT date, category_return_equal_weighted FROM category_monthly_returns "
            "WHERE category_key = ? ORDER BY date",
            [category_key],
        )
        if not cat.empty:
            returns = pd.Series(
                cat["category_return_equal_weighted"].to_numpy(),
                index=pd.DatetimeIndex(pd.to_datetime(cat["date"])),
            ).dropna()
            level = (1.0 + returns).cumprod() * 100.0
            cat_frame = pd.DataFrame({"nav": level, "obs_date": level.index}, index=level.index)
            cat_roll = rolling_cagr(cat_frame, horizon)
            category_points = [
                {"date": str(pd.Timestamp(cast(Any, d)).date()), "value": float(v)}
                for d, v in cat_roll.items()
            ]

    return {
        "scheme_code": scheme_code,
        "horizon_years": horizon,
        # Non-null when the series was cut at a NAV redenomination, so the chart can
        # say why it starts where it does instead of looking like a young fund.
        "scale_break_at": str(scale_break_at.date()) if scale_break_at is not None else None,
        "points": [
            {"date": str(pd.Timestamp(cast(Any, d)).date()), "value": float(v)}
            for d, v in series.items()
        ],
        "category_points": category_points,
        "summary": {
            "mean": summary.mean.value,
            "median": summary.median.value,
            "min": summary.minimum.value,
            "max": summary.maximum.value,
            "std": summary.std.value,
            "positive_pct": summary.positive_pct.value,
            "window_count": summary.window_count,
            "reason": summary.mean.reason,
        },
    }


# A fall shallower than this is market noise rather than an episode worth naming.
BEHAVIOUR_MIN_DEPTH: Final = 0.10
BEHAVIOUR_MAX_EPISODES: Final = 5
# TER is a proportional drag, so the shortfall it causes against a cheaper peer is the
# same whatever the market returns. Ten years is stated rather than assumed silently.
COST_HORIZON_YEARS: Final = 10


def _category_monthly(scheme_code: str) -> tuple[str | None, pd.Series]:
    """The scheme's peer return series, indexed by month end."""
    category_key = query_optional(
        "SELECT category_key FROM scheme_metrics_snapshot WHERE scheme_code = ? "
        "ORDER BY as_of_date DESC LIMIT 1",
        [scheme_code],
    )
    if not category_key:
        return None, pd.Series(dtype=float)
    rows = query_df(
        "SELECT date, category_return_equal_weighted FROM category_monthly_returns "
        "WHERE category_key = ? ORDER BY date",
        [category_key],
    )
    if rows.empty:
        return str(category_key), pd.Series(dtype=float)
    series = pd.Series(
        rows["category_return_equal_weighted"].to_numpy(),
        index=pd.DatetimeIndex(pd.to_datetime(rows["date"])),
    ).dropna()
    return str(category_key), series


def _cost_position(scheme_code: str) -> dict[str, Any]:
    """This scheme's expense ratio against the median of its Direct-Growth peers."""
    own = query_optional(
        "SELECT expense_ratio FROM scheme_ter WHERE scheme_code = ?", [scheme_code]
    )
    peers = query_df(
        "SELECT t.expense_ratio FROM scheme_ter t JOIN scheme_master m USING (scheme_code) "
        "WHERE m.peer_group = (SELECT peer_group FROM scheme_master "
        "WHERE scheme_code = ?) AND m.clean_plan = 'Direct' AND m.clean_option = 'Growth' "
        "AND m.is_active AND t.expense_ratio IS NOT NULL",
        [scheme_code],
    )
    median = float(peers["expense_ratio"].median()) if not peers.empty else None
    cost: dict[str, Any] = {
        "expense_ratio": float(own) if own is not None else None,
        "category_median": median,
        "category_count": len(peers),
        "reason": None if own is not None else Reason.TER_NOT_PUBLISHED,
        "horizon_years": COST_HORIZON_YEARS,
        "difference": None,
        "shortfall_vs_median": None,
    }
    if own is not None and median is not None:
        cost["difference"] = float(own) - median
        # What the fee gap alone compounds to, as a share of final value. Independent of
        # the market return, because both funds earn the same gross return by assumption.
        cost["shortfall_vs_median"] = (
            (1.0 - float(own)) / (1.0 - median)
        ) ** COST_HORIZON_YEARS - 1
    return cost


def _snapshot_capture(scheme_code: str) -> dict[str, Any]:
    """Capture ratios as the snapshot computed them, per horizon.

    Computed here from the whole-category mean rather than read from the snapshot, this
    silently disagreed with `upside_capture_3y`: the snapshot leaves the fund out of its
    own peer average and this did not, and the two used different windows. Capture needs
    two years of paired months, so a fund young enough to have no snapshot row could not
    produce one anyway, and serving the stored value is what makes the two agree by
    construction instead of by two implementations staying in step.
    """
    rows = query_df(
        "SELECT "
        + ", ".join(
            [f"upside_capture_{h}y, downside_capture_{h}y" for h in CAPTURE_HORIZONS]
            + ["missing_reasons"]
        )
        + " FROM scheme_metrics_snapshot WHERE scheme_code = ? ORDER BY as_of_date DESC LIMIT 1",
        [scheme_code],
    )
    if rows.empty:
        absent = {
            "up": None,
            "down": None,
            "reason": Reason.INSUFFICIENT_HISTORY,
        }
        return {f"{h}y": dict(absent) for h in CAPTURE_HORIZONS}
    record = _clean_records(rows)[0]
    reasons = record.get("missing_reasons") or {}
    return {
        f"{h}y": {
            "up": record.get(f"upside_capture_{h}y"),
            "down": record.get(f"downside_capture_{h}y"),
            "reason": reasons.get(f"upside_capture_{h}y") or reasons.get(f"downside_capture_{h}y"),
        }
        for h in CAPTURE_HORIZONS
    }


@app.get("/schemes/{scheme_code}/behaviour", tags=["metrics"])
def scheme_behaviour(scheme_code: str) -> dict[str, Any]:
    """How the fund behaved rather than how it scored: falls, calendar years, cost.

    Every figure here is computed live from the stored NAV rather than read from the
    metrics snapshot, so it stays available for a fund too young to have one.
    """
    _scheme_or_404(scheme_code)
    daily = query_df(
        "SELECT date, nav FROM nav_daily WHERE scheme_code = ? ORDER BY date", [scheme_code]
    )
    episodes: list[dict[str, Any]] = []
    if not daily.empty:
        nav = pd.Series(
            daily["nav"].to_numpy(), index=pd.DatetimeIndex(pd.to_datetime(daily["date"]))
        )
        episodes = [
            {
                "peak_date": str(e.peak_date.date()),
                "trough_date": str(e.trough_date.date()),
                "depth": e.depth,
                "recovered_date": None
                if e.recovered_date is None
                else str(e.recovered_date.date()),
                "days_to_trough": e.days_to_trough,
                "days_to_recover": e.days_to_recover,
            }
            for e in drawdown_episodes(nav, BEHAVIOUR_MIN_DEPTH, BEHAVIOUR_MAX_EPISODES)
        ]

    own = query_df(
        "SELECT date, monthly_return FROM monthly_returns WHERE scheme_code = ? ORDER BY date",
        [scheme_code],
    )
    fund = (
        pd.Series(
            own["monthly_return"].to_numpy(),
            index=pd.DatetimeIndex(pd.to_datetime(own["date"])),
        ).dropna()
        if not own.empty
        else pd.Series(dtype=float)
    )
    category_key, peers = _category_monthly(scheme_code)

    peer_years: dict[int, float] = {
        int(record["year"]): float(record["fund_return"])
        for record in calendar_year_returns(peers).to_dict("records")
    }
    calendar = [
        {
            "year": int(record["year"]),
            "fund_return": float(record["fund_return"]),
            "months": int(record["months"]),
            "category_return": peer_years.get(int(record["year"])),
        }
        for record in calendar_year_returns(fund).to_dict("records")
    ]

    capture = _snapshot_capture(scheme_code)
    return {
        "scheme_code": scheme_code,
        "category_key": category_key,
        "min_drawdown_depth": BEHAVIOUR_MIN_DEPTH,
        "drawdowns": episodes,
        "calendar_years": calendar,
        # Against the leave-one-out peer average, not a benchmark, and not the same
        # number as capture against an index. The UI has to say which.
        "capture_peer_basis": "leave_one_out_category_average",
        "capture_by_horizon": capture,
        "capture": {
            **capture[f"{CAPTURE_HORIZONS[0]}y"],
            "horizon_years": CAPTURE_HORIZONS[0],
        },
        "cost": _cost_position(scheme_code),
        "disclaimer": DISCLAIMER,
    }


def _net_return_out(metric: Any) -> dict[str, Any]:
    out = _metric_out(metric)
    out["reason_description"] = _REASON_DESCRIPTIONS.get(metric.reason) if metric.reason else None
    return out


def _load_row_field(rows: pd.DataFrame, column: str) -> float | None:
    if rows.empty or pd.isna(rows[column].iloc[0]):
        return None
    return float(rows[column].iloc[0])


@app.get("/schemes/{scheme_code}/net-returns", tags=["metrics"])
def scheme_net_returns(
    scheme_code: str,
    horizon: Annotated[int, Query(ge=1, le=15)] = 5,
    mode: Literal["lumpsum", "sip"] = "lumpsum",
) -> dict[str, Any]:
    """Gross, after-tax and after-tax-and-load returns, side by side.

    A display layer over the existing gross return, never a stored ranking column,
    because the applicable rate depends on the holder rather than the fund.
    """
    scheme = _scheme_or_404(scheme_code)
    frame, _ = _monthly_frame(scheme_code)
    clean_category = str(scheme.get("clean_category") or "")
    clean_sub_category = str(scheme.get("clean_sub_category") or "")
    load_rows = query_df(
        f"SELECT exit_load_pct, exit_load_period_days FROM {scheme_attributes.TABLE.name} "
        "WHERE scheme_code = ?",
        [scheme_code],
    )
    exit_load_pct = _load_row_field(load_rows, "exit_load_pct")
    exit_load_period_days = _load_row_field(load_rows, "exit_load_period_days")
    if mode == "lumpsum":
        gross = trailing_cagr(frame, horizon, settings.mf_month_end_tolerance_days).metric
        result = tax_metrics.after_tax_lumpsum(
            gross,
            float(horizon),
            clean_category,
            clean_sub_category,
            settings,
            exit_load_pct=exit_load_pct,
            exit_load_period_days=exit_load_period_days,
        )
    else:
        result = tax_metrics.after_tax_sip(
            frame,
            horizon,
            clean_category,
            clean_sub_category,
            settings,
            exit_load_pct=exit_load_pct,
            exit_load_period_days=exit_load_period_days,
        )
    return {
        "scheme_code": scheme_code,
        "horizon_years": horizon,
        "mode": mode,
        "clean_category": clean_category,
        "clean_sub_category": clean_sub_category,
        "orientation": result.orientation,
        "gross_return": _net_return_out(result.gross),
        "after_tax_return": _net_return_out(result.after_tax),
        "after_tax_and_load_return": _net_return_out(result.after_tax_and_load),
        "assumptions": result.assumptions,
        "disclaimer": DISCLAIMER,
    }


_EXPOSURE_CAVEAT = (
    "Estimated from NAV behaviour, not from holdings. AMFI publishes no portfolio, "
    "so no company or sector weight on this page is a disclosed position. Two funds "
    "holding different stocks with the same tilt would look identical here. Each "
    "factor is an index fund's NAV, so it is already net of that fund's own costs."
)


def _style_basis(scheme_code: str) -> tuple[pd.Series, pd.DataFrame, dict[str, str]]:
    """Fund monthly returns, the wide style-factor basis, and its display names."""
    basis = query_df(
        "SELECT benchmark_id, any_value(benchmark_name) AS benchmark_name FROM benchmarks "
        "WHERE asset_class = ? GROUP BY benchmark_id ORDER BY benchmark_id",
        [STYLE_FACTOR_CLASS],
    )
    names = {str(r["benchmark_id"]): str(r["benchmark_name"]) for r in _clean_records(basis)}
    own = query_df(
        "SELECT date, monthly_return FROM monthly_returns WHERE scheme_code = ? ORDER BY date",
        [scheme_code],
    )
    factor_rows = query_df(
        "SELECT benchmark_id, date, monthly_return FROM benchmarks WHERE asset_class = ?",
        [STYLE_FACTOR_CLASS],
    )
    fund = (
        pd.Series(
            own["monthly_return"].to_numpy(),
            index=pd.DatetimeIndex(pd.to_datetime(own["date"])),
        ).dropna()
        if not own.empty
        else pd.Series(dtype=float)
    )
    factors = (
        factor_rows.assign(date=pd.to_datetime(factor_rows["date"]))
        .pivot(index="date", columns="benchmark_id", values="monthly_return")
        .dropna(how="all")
        if not factor_rows.empty
        else pd.DataFrame()
    )
    return fund, factors, names


def _exposure_weights(result: Exposure, names: dict[str, str]) -> list[dict[str, Any]]:
    return [
        {"benchmark_id": bid, "benchmark_name": names.get(bid, bid), "weight": weight}
        for bid, weight in sorted(result.weights.items(), key=lambda kv: -kv[1])
    ]


@app.get("/schemes/{scheme_code}/exposure", tags=["metrics"])
def scheme_exposure(scheme_code: str, rolling: bool = False) -> dict[str, Any]:
    """What the fund behaves like, fitted to the style-factor basis.

    AMFI publishes no portfolio, so this is inferred from NAV rather than read from
    holdings: the long-only mix of index returns that best explains the fund's own
    monthly returns. It describes behaviour, and names no company.

    With `rolling=true`, the fit is refit on every trailing 36-month window stepped
    monthly instead of once over the whole history, so drift in the mix over time is
    visible rather than averaged away.
    """
    _scheme_or_404(scheme_code)
    fund, factors, names = _style_basis(scheme_code)
    basis = [{"benchmark_id": bid, "benchmark_name": name} for bid, name in names.items()]

    if not rolling:
        result = style_exposure(fund, factors)
        return {
            "scheme_code": scheme_code,
            "method": "returns_based_style_analysis",
            "weights": _exposure_weights(result, names),
            "r_squared": result.r_squared,
            "months": result.months,
            "first_date": None if result.first_date is None else str(result.first_date.date()),
            "last_date": None if result.last_date is None else str(result.last_date.date()),
            "reason": result.reason,
            "basis": basis,
            "caveat": _EXPOSURE_CAVEAT,
            "disclaimer": DISCLAIMER,
        }

    windows = rolling_style_exposure(fund, factors)
    drift = style_drift(windows)
    return {
        "scheme_code": scheme_code,
        "method": "rolling_returns_based_style_analysis",
        "window_months": ROLLING_WINDOW_MONTHS,
        "points": [
            {
                "end_date": None if w.last_date is None else str(w.last_date.date()),
                "r_squared": w.r_squared,
                "months": w.months,
                "weights": _exposure_weights(w, names) if w.reason is None else None,
                "reason": w.reason,
            }
            for w in windows
        ],
        "style_drift_3y": {
            "value": drift.value,
            "n_obs": drift.n_obs,
            "reason": drift.reason,
        },
        "basis": basis,
        "caveat": (
            _EXPOSURE_CAVEAT + " A window whose fit falls below the R-squared floor is "
            "dropped from the series with that reason, never carried forward as a guess."
        ),
        "disclaimer": DISCLAIMER,
    }


@app.get("/schemes/{scheme_code}/comparison", tags=["metrics"])
def scheme_comparison(
    scheme_code: str,
    level: Literal["sub_category", "category"] = "sub_category",
    plan_scope: Literal["direct", "direct_regular", "all"] = "direct",
    option_scope: Literal["growth", "all"] = "growth",
    active_only: bool = True,
    aggregation: Literal["mean", "median"] = "mean",
    exclude_self: bool = True,
) -> dict[str, Any]:
    """Peer comparison recomputed live for the chosen methodology toggles.

    The stored snapshot only covers the default universe; changing a toggle here
    recomputes trailing CAGR across the peer group on the fly.
    """
    from mf_analytics.metrics.relative import compare_to_peers, peer_average

    scheme = _scheme_or_404(scheme_code)
    universe = PeerUniverse(
        level=level,
        plan_scope=plan_scope,
        option_scope=option_scope,
        active_only=active_only,
        aggregation=aggregation,
        exclude_self=exclude_self,
        min_peers=settings.mf_min_peers,
    )
    label_col = universe.label_column()
    label = scheme[label_col]
    master = query_df("SELECT * FROM scheme_master")
    master["scheme_code"] = master["scheme_code"].astype(str)
    peers = universe.filter(master)
    peers = peers[peers[label_col] == label]
    codes = peers["scheme_code"].tolist()
    if scheme_code not in codes:
        codes.append(scheme_code)

    monthly = query_df(
        f"SELECT scheme_code, date, nav, obs_date FROM nav_monthly WHERE scheme_code IN "
        f"({', '.join('?' * len(codes))}) ORDER BY scheme_code, date",
        codes,
    )
    horizons = (1, 3, 5, 10)
    cagr: dict[int, dict[str, float]] = {h: {} for h in horizons}
    for code, rows in monthly.groupby("scheme_code", sort=False):
        frame, _ = comparable_grid(rows, settings.mf_nav_jump_ratio)
        for h in horizons:
            result = trailing_cagr(frame, h, settings.mf_month_end_tolerance_days)
            if result.metric.value is not None:
                cagr[h][str(code)] = result.metric.value

    out: dict[str, Any] = {}
    for h in horizons:
        own = cagr[h].get(scheme_code)
        peer = peer_average(
            cagr[h],
            scheme_code,
            aggregation=universe.aggregation,
            exclude_self=universe.exclude_self,
            min_peers=settings.mf_min_peers,
        )
        from mf_analytics.quality import Metric, Reason

        own_metric = Metric(own) if own is not None else Metric.missing(Reason.INSUFFICIENT_HISTORY)
        comparison = compare_to_peers(own_metric, peer)
        out[f"{h}y"] = {
            "fund_cagr": own,
            "category_return": comparison.category_return.value,
            "excess": comparison.excess.value,
            "ratio": comparison.ratio.value,
            "ratio_reason": comparison.ratio.reason,
            "peer_count": comparison.peer_count,
            "reason": comparison.category_return.reason,
        }
    return {
        "scheme_code": scheme_code,
        "label": label,
        "universe": universe.model_dump(),
        "peer_universe_size": len(codes),
        "horizons": out,
        "peers": _clean_records(
            peers.loc[:, ["scheme_code", "scheme_name", "amc", "latest_aum", "fund_age_years"]]
        ),
    }


MAX_BASKET_FUNDS: Final = 10
BASKET_WEIGHT_TOLERANCE: Final = 1e-6


class BasketRequest(BaseModel):
    scheme_codes: list[str] = Field(min_length=1, max_length=MAX_BASKET_FUNDS)
    weights: list[float] | None = None

    @field_validator("scheme_codes")
    @classmethod
    def _unique(cls, codes: list[str]) -> list[str]:
        if len(set(codes)) != len(codes):
            raise ValueError("scheme_codes must not repeat")
        return codes

    @model_validator(mode="after")
    def _weights_match_codes(self) -> BasketRequest:
        if self.weights is None:
            return self
        if len(self.weights) != len(self.scheme_codes):
            raise ValueError("weights must have one entry per scheme_code")
        if any(w < 0 for w in self.weights):
            raise ValueError("weights must be non-negative")
        if abs(sum(self.weights) - 1.0) > BASKET_WEIGHT_TOLERANCE:
            raise ValueError("weights must sum to 1")
        return self


def _metric_out(metric: Any) -> dict[str, Any]:
    return {"value": metric.value, "n_obs": metric.n_obs, "reason": metric.reason}


@app.post("/basket", tags=["metrics"])
def basket(payload: Annotated[BasketRequest, Body()]) -> dict[str, Any]:
    """Correlation and blended risk/return for a hand-picked basket of up to 10 funds.

    Correlation of returns is not portfolio overlap: two funds holding entirely
    different stocks can still move together every month, and two funds holding the
    same stocks in different weights can show up here as only loosely correlated.
    """
    codes = payload.scheme_codes
    for code in codes:
        _scheme_or_404(code)
    weights = (
        dict(zip(codes, payload.weights, strict=True))
        if payload.weights is not None
        else {code: 1.0 / len(codes) for code in codes}
    )

    rows = query_df(
        "SELECT scheme_code, date, monthly_return FROM monthly_returns "
        f"WHERE scheme_code IN ({', '.join('?' * len(codes))}) ORDER BY scheme_code, date",
        codes,
    )
    returns = {
        str(code): pd.Series(
            group["monthly_return"].to_numpy(),
            index=pd.DatetimeIndex(pd.to_datetime(group["date"])),
        )
        for code, group in rows.groupby("scheme_code", sort=False)
    }
    for code in codes:
        returns.setdefault(code, pd.Series(dtype=float))

    result = compute_basket(returns, weights, settings.risk_free_monthly)
    if result is None:
        return {
            "scheme_codes": codes,
            "weights": weights,
            "min_observations": BASKET_MIN_OBS,
            "matched_months": len(matched_returns(returns)),
            "reason": Reason.INSUFFICIENT_HISTORY,
            "reason_description": _REASON_DESCRIPTIONS[Reason.INSUFFICIENT_HISTORY],
            "disclaimer": DISCLAIMER,
        }

    corr = result.correlation
    correlation_matrix = [
        {
            "scheme_code": row,
            "correlations": {col: float(corr.loc[row, col]) for col in corr.columns},
        }
        for row in corr.index
    ]
    return {
        "scheme_codes": codes,
        "weights": weights,
        "min_observations": BASKET_MIN_OBS,
        "matched_months": result.matched_months,
        "correlation_matrix": correlation_matrix,
        "blended": {
            "monthly_returns": [
                {"date": str(pd.Timestamp(cast(Any, d)).date()), "value": float(v)}
                for d, v in result.blended_returns.items()
            ],
            "cagr": _metric_out(result.cagr),
            "volatility": _metric_out(result.volatility),
            "sharpe": _metric_out(result.sharpe),
            "max_drawdown": _metric_out(result.max_drawdown),
        },
        "diversification_benefit": _metric_out(result.diversification_benefit),
        "components": [
            {
                "scheme_code": code,
                "weight": component.weight,
                "cagr": _metric_out(component.cagr),
                "volatility": _metric_out(component.volatility),
                "sharpe": _metric_out(component.sharpe),
                "max_drawdown": _metric_out(component.max_drawdown),
                "capture_vs_blended": {
                    "up": _metric_out(component.capture_vs_blended.up),
                    "down": _metric_out(component.capture_vs_blended.down),
                },
            }
            for code, component in result.components.items()
        ],
        "disclaimer": DISCLAIMER,
    }


@app.get("/benchmarks", tags=["meta"])
def benchmarks_overview() -> dict[str, Any]:
    """Loaded benchmark series, the mapping rules that assign them, and coverage gaps."""
    coverage = benchmark_ingest.coverage_report(query_df)
    config = benchmark_ingest.load_mapping_config(settings)
    rules = [
        {
            "sub_category_contains": rule.get("sub_category_contains", []),
            "scheme_name_contains": rule.get("scheme_name_contains", []),
            # Without these two a sectoral rule reads as though it claimed every
            # Sectoral/Thematic fund for one sector index, which is the opposite of
            # what "match: all" plus an exclusion list actually does.
            "match": rule.get("match", "any"),
            "scheme_name_excludes": rule.get("scheme_name_excludes", []),
            "benchmark_id": rule["benchmark_id"],
            "fallback_benchmark_ids": rule.get("fallback_benchmark_ids", []),
            "notes": rule.get("notes"),
        }
        for rule in config["mappings"]
    ]
    mapped = _clean_records(
        query_df(
            "SELECT m.benchmark_id, m.confidence, count(*) AS schemes, "
            "any_value(s.clean_sub_category) AS example_sub_category "
            "FROM scheme_benchmark_map m JOIN scheme_master s USING (scheme_code) "
            "GROUP BY m.benchmark_id, m.confidence ORDER BY schemes DESC"
        )
    )
    return {
        "fund_currency": BASE_CURRENCY,
        "currency_policy": (
            f"Fund NAVs are published in {BASE_CURRENCY}. A benchmark in any other currency "
            "is stored and shown, but no benchmark-relative metric is computed against it: "
            "the difference would include the exchange rate. This project does no FX "
            "conversion. Import an INR-converted series to compare against a foreign index."
        ),
        "config_version": config.get("version"),
        "mapping_rules": rules,
        "mapped_counts": mapped,
        **coverage,
        "disclaimer": DISCLAIMER,
    }


@app.get("/facets", tags=["meta"])
def facets() -> dict[str, list[str]]:
    """Every value each list filter can take, over the whole master rather than a page of it."""
    return {
        name: [
            row[0]
            for row in query_df(
                # the column name comes from this literal tuple, never from a request
                f"SELECT DISTINCT {column} FROM scheme_master "
                f"WHERE {column} IS NOT NULL AND {column} <> '' ORDER BY 1"
            ).itertuples(index=False)
        ]
        for name, column in (
            ("sub_categories", "clean_sub_category"),
            ("cap_bands", "cap_band"),
            ("styles", "style"),
            ("amcs", "amc"),
        )
    }


@app.get("/categories", tags=["categories"])
def categories() -> dict[str, Any]:
    rows = query_df(
        "SELECT clean_category, clean_sub_category, count(*) AS scheme_count, "
        "count(*) FILTER (WHERE clean_plan = 'Direct' AND clean_option = 'Growth' AND is_active) "
        "AS direct_growth_active_count "
        "FROM scheme_master GROUP BY 1, 2 ORDER BY 1, 2"
    )
    return {"items": _clean_records(rows)}


def _category_snapshot_row(category_key: str) -> dict[str, Any] | None:
    rows = query_df(
        "SELECT * FROM category_metrics_snapshot WHERE category_key = ? "
        "ORDER BY as_of_date DESC LIMIT 1",
        [category_key],
    )
    return _clean_records(rows)[0] if not rows.empty else None


def _survivorship_gap(
    category_key: str, current: dict[str, Any]
) -> tuple[dict[str, Any] | None, dict[str, Any] | None, dict[str, float | None]]:
    """Both sides of the same category aggregate, and the gap in percentage points.

    T2.4: the counterpart category_key differs only in the active/all-schemes
    marker, so it names the other side of the same peer group. A positive gap on
    a cagr_*y column means the active-only average overstates the category by
    leaving out schemes that closed or merged away.
    """
    try:
        counterpart_key = counterpart_category_key(category_key)
    except ValueError:
        return None, None, {}
    counterpart = _category_snapshot_row(counterpart_key)
    active_only = current if is_active_only_key(category_key) else counterpart
    all_schemes = counterpart if is_active_only_key(category_key) else current
    gap: dict[str, float | None] = {}
    if active_only and all_schemes:
        for h in TRAILING_HORIZONS:
            col = f"cagr_{h}y"
            a, b = active_only.get(col), all_schemes.get(col)
            gap[col] = round((a - b) * 100, 4) if a is not None and b is not None else None
    return active_only, all_schemes, gap


@app.get("/categories/{category_key:path}/metrics", tags=["categories"])
def category_metrics(category_key: str) -> dict[str, Any]:
    current = _category_snapshot_row(category_key)
    if current is None:
        raise HTTPException(status_code=404, detail=f"Unknown category_key {category_key!r}")
    monthly = query_df(
        "SELECT date, category_return_equal_weighted, category_return_median, "
        "eligible_scheme_count FROM category_monthly_returns WHERE category_key = ? ORDER BY date",
        [category_key],
    )
    active_only, all_schemes, gap = _survivorship_gap(category_key, current)
    return {
        **current,
        "monthly_returns": _clean_records(monthly),
        "active_only": active_only,
        "all_schemes": all_schemes,
        "survivorship_gap_pp": gap,
    }


# T3.2 screener filters on scheme_attributes (riskometer, exit load, manager tenure,
# ...) are named like every other `<column>_min`/`<column>_max` range so the frontend
# reuses its existing range-filter widget, but `parse_ranges` would reject them as
# unknown - `NUMERIC_BY_NAME` is the snapshot's own column registry, and the fence
# built in T3.1 means these can never be added to it: an enrichment column must never
# reach a query over `scheme_metrics_snapshot`. So they are pulled out of the query
# params here, before `parse_ranges` ever sees them, and applied afterwards in
# `screen()` by filtering the screen's already-computed result set.
_ATTRIBUTE_RANGE_KEYS: Final = ("exit_load_pct_max", "manager_tenure_years_min")


def _attribute_filters(request: Request) -> dict[str, float]:
    out: dict[str, float] = {}
    for key in _ATTRIBUTE_RANGE_KEYS:
        raw = request.query_params.get(key)
        if raw not in (None, ""):
            try:
                out[key] = float(raw)
            except ValueError as exc:
                raise HTTPException(status_code=400, detail=f"{key} must be a number") from exc
    return out


def _build_request(
    request: Request,
    page: int,
    page_size: int,
    search: str | None,
    sort: str | None,
    columns: str | None,
    category: list[str] | None,
    sub_category: list[str] | None,
    cap_band: list[str] | None,
    style: list[str] | None,
    amc: list[str] | None,
    plan: list[str] | None,
    option: list[str] | None,
    active_only: bool,
    dedupe_families: bool,
) -> ScreenRequest:
    try:
        return ScreenRequest(
            page=page,
            page_size=page_size,
            search=search,
            sort=parse_sort(sort),
            columns=parse_columns(columns),
            categories=category or [],
            sub_categories=sub_category or [],
            cap_bands=cap_band or [],
            styles=style or [],
            amcs=amc or [],
            plans=plan if plan is not None else ["Direct"],
            options=option if option is not None else ["Growth"],
            active_only=active_only,
            dedupe_families=dedupe_families,
            ranges=parse_ranges(
                {k: v for k, v in request.query_params.items() if k not in _ATTRIBUTE_RANGE_KEYS}
            ),
        )
    except FilterError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


def _eligible_codes_by_attributes(attribute_filters: dict[str, float]) -> set[str]:
    """Scheme codes `scheme_attributes` confirms satisfy every attribute filter given.

    A scheme with no row, or a null field, does not satisfy any filter here - "no
    exit load" means the source confirms zero, not that the source has nothing.
    """
    clauses: list[str] = []
    params: list[Any] = []
    if "exit_load_pct_max" in attribute_filters:
        clauses.append("exit_load_pct IS NOT NULL AND exit_load_pct <= ?")
        params.append(attribute_filters["exit_load_pct_max"])
    if "manager_tenure_years_min" in attribute_filters:
        clauses.append(
            "manager_start_date IS NOT NULL AND "
            "date_diff('day', manager_start_date, current_date) / 365.25 >= ?"
        )
        params.append(attribute_filters["manager_tenure_years_min"])
    where = " AND ".join(clauses)
    rows = query_df(f"SELECT scheme_code FROM {scheme_attributes.TABLE.name} WHERE {where}", params)
    return set(rows["scheme_code"])


def _screen_with_attribute_filters(
    req: ScreenRequest, attribute_filters: dict[str, float]
) -> tuple[pd.DataFrame, int]:
    """`run_screen`'s own pagination is SQL over `scheme_metrics_snapshot`, which an
    enrichment table must never join into (the T3.1 fence). So the full sorted match
    is fetched once here and paged in pandas instead - `scheme_attributes` is at most
    one row per scheme, tiny next to the snapshot, so this stays cheap.
    """
    eligible = _eligible_codes_by_attributes(attribute_filters)
    if not eligible:
        return pd.DataFrame(columns=req.columns), 0
    full = run_export(req, limit=100_000)
    matched = full[full["scheme_code"].isin(eligible)].reset_index(drop=True)
    offset = (req.page - 1) * req.page_size
    return matched.iloc[offset : offset + req.page_size].reset_index(drop=True), len(matched)


@app.get("/screen", tags=["screen"])
def screen(
    request: Request,
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=500)] = 50,
    search: str | None = None,
    sort: str | None = None,
    columns: str | None = None,
    category: Annotated[list[str] | None, Query()] = None,
    sub_category: Annotated[list[str] | None, Query()] = None,
    cap_band: Annotated[list[str] | None, Query()] = None,
    style: Annotated[list[str] | None, Query()] = None,
    amc: Annotated[list[str] | None, Query()] = None,
    plan: Annotated[list[str] | None, Query()] = None,
    option: Annotated[list[str] | None, Query()] = None,
    active_only: bool = True,
    dedupe_families: Annotated[
        bool,
        Query(
            description="One row per fund rather than per scheme code. Off shows the "
            "Direct, Regular, Growth and IDCW variants of a fund as separate rows."
        ),
    ] = True,
    exit_load_pct_max: Annotated[
        float | None,
        Query(description="Only funds with a confirmed exit load at or below this (0 = none)"),
    ] = None,
    manager_tenure_years_min: Annotated[
        float | None,
        Query(description="Only funds whose current manager has served at least this long"),
    ] = None,
) -> dict[str, Any]:
    req = _build_request(
        request,
        page,
        page_size,
        search,
        sort,
        columns,
        category,
        sub_category,
        cap_band,
        style,
        amc,
        plan,
        option,
        active_only,
        dedupe_families,
    )
    attribute_filters = _attribute_filters(request)
    frame, total = (
        _screen_with_attribute_filters(req, attribute_filters)
        if attribute_filters
        else run_screen(req)
    )
    as_of = query_scalar("SELECT max(as_of_date) FROM scheme_metrics_snapshot")
    return {
        "total": total,
        "page": req.page,
        "page_size": req.page_size,
        "pages": (total + req.page_size - 1) // req.page_size,
        "columns": req.columns,
        "rows": _clean_records(frame),
        "methodology": {
            "as_of": str(as_of) if as_of else None,
            "version": settings.mf_methodology_version,
            "peer_universe": DEFAULT_UNIVERSE.model_dump(),
            "risk_free_annual": settings.mf_risk_free_annual,
            "applied_filters": {
                "plans": req.plans,
                "options": req.options,
                "active_only": req.active_only,
                "categories": req.categories,
                "sub_categories": req.sub_categories,
                "cap_bands": req.cap_bands,
                "styles": req.styles,
                "amcs": req.amcs,
                "search": req.search,
                "ranges": req.ranges,
                "attribute_filters": attribute_filters,
            },
            "sort": [f"{c}:{d}" for c, d in req.sort],
            "note": (
                "Peer-relative metrics come from the stored snapshot, which uses the default "
                "peer universe. Change the universe on a fund page to recompute it live."
            ),
            "disclaimer": DISCLAIMER,
        },
    }


@app.get("/export/csv", tags=["screen"])
def export_csv(
    request: Request,
    search: str | None = None,
    sort: str | None = None,
    columns: str | None = None,
    category: Annotated[list[str] | None, Query()] = None,
    sub_category: Annotated[list[str] | None, Query()] = None,
    cap_band: Annotated[list[str] | None, Query()] = None,
    style: Annotated[list[str] | None, Query()] = None,
    amc: Annotated[list[str] | None, Query()] = None,
    plan: Annotated[list[str] | None, Query()] = None,
    option: Annotated[list[str] | None, Query()] = None,
    active_only: bool = True,
    dedupe_families: Annotated[
        bool,
        Query(description="One row per fund rather than per scheme code, as on the screener."),
    ] = True,
) -> StreamingResponse:
    req = _build_request(
        request,
        1,
        1,
        search,
        sort,
        columns,
        category,
        sub_category,
        cap_band,
        style,
        amc,
        plan,
        option,
        active_only,
        dedupe_families,
    )
    frame = run_export(req)
    as_of = query_scalar("SELECT max(as_of_date) FROM scheme_metrics_snapshot")
    buffer = io.StringIO()
    buffer.write(f"# Indian MF screener export. {DISCLAIMER}\n")
    buffer.write(
        f"# metrics_as_of={as_of or 'unknown'} "
        f"methodology_version={settings.mf_methodology_version}\n"
    )
    buffer.write(f"# peer_universe={json.dumps(DEFAULT_UNIVERSE.model_dump())}\n")
    frame.to_csv(buffer, index=False)
    buffer.seek(0)
    return StreamingResponse(
        iter([buffer.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": 'attachment; filename="mf-screen.csv"'},
    )


class RefreshRequest(BaseModel):
    step: str = Field(
        default="data-refresh",
        pattern=(
            "^(data-master|data-nav|data-refresh|data-sample|metrics-build|benchmark-map"
            "|aum-history-import)$"
        ),
    )
    force: bool = False
    # Only metrics-build parallelises; 0 there means every core but one.
    jobs: int = Field(default=1, ge=0)


@app.post("/admin/refresh", tags=["admin"])
def admin_refresh(payload: Annotated[RefreshRequest, Body()]) -> dict[str, Any]:
    """Run one pipeline step as a subprocess so a long ingest cannot block the API loop."""
    command = [sys.executable, "-m", "mf_analytics.cli", payload.step]
    if payload.force and payload.step in {"data-master", "data-nav"}:
        command.append("--force")
    if payload.step == "metrics-build":
        command += ["--jobs", str(payload.jobs)]
    # Released before the subprocess starts so it can take the write lock, and again
    # afterwards so the next request reopens against the refreshed store.
    close_connection()
    result = subprocess.run(command, capture_output=True, text=True, timeout=3600)
    close_connection()
    if result.returncode != 0:
        raise HTTPException(status_code=500, detail=result.stderr[-4000:])
    return {"step": payload.step, "stdout": result.stdout[-4000:], "status": "ok"}


class BenchmarkImportRequest(BaseModel):
    file_path: str
    apply_mapping: bool = True


def _benchmark_path(raw: str) -> Path:
    """Confine benchmark imports to the data directory, so this is not a file reader."""
    path = Path(raw).expanduser().resolve()
    data_root = settings.mf_data_dir.resolve()
    if not path.is_relative_to(data_root):
        raise HTTPException(status_code=400, detail=f"Benchmark CSVs must live under {data_root}")
    if not path.is_file():
        raise HTTPException(status_code=404, detail=f"No such file: {path}")
    return path


@app.post("/admin/import-benchmark", tags=["admin"])
def admin_import_benchmark(payload: Annotated[BenchmarkImportRequest, Body()]) -> dict[str, Any]:
    path = _benchmark_path(payload.file_path)
    close_connection()
    try:
        info = benchmark_ingest.import_csv(path, settings)
    except benchmark_ingest.BenchmarkCsvError as exc:
        # The file is wrong, not the server: hand back what to fix.
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    if payload.apply_mapping:
        info["mapping"] = benchmark_ingest.apply_mapping(settings)
    close_connection()
    return info


class BenchmarkValidateRequest(BaseModel):
    file_path: str


@app.post("/admin/validate-benchmark", tags=["admin"])
def admin_validate_benchmark(
    payload: Annotated[BenchmarkValidateRequest, Body()],
) -> dict[str, Any]:
    """Check a benchmark CSV against the import contract without writing anything."""
    path = _benchmark_path(payload.file_path)
    try:
        return benchmark_ingest.validate_csv(path)
    except benchmark_ingest.BenchmarkCsvError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@app.get("/presets/{preset_id}", tags=["meta"])
def preset(preset_id: str) -> dict[str, Any]:
    if preset_id not in PRESETS_BY_ID:
        raise HTTPException(status_code=404, detail=f"Unknown preset {preset_id!r}")
    return PRESETS_BY_ID[preset_id]


# ---------------------------------------------------------------------------
# T3.3: holdings, turnover and overlap. Enrichment throughout - none of it enters
# scheme_metrics_snapshot, a ranking or a risk computation.
# ---------------------------------------------------------------------------

_HOLDINGS_CAVEAT: Final = (
    "Holdings are a month-old photograph filed by the AMC, not a live portfolio: the fund "
    "may have traded since the as-of month stated here. This project ships no holdings "
    "data and fetches none - every row shown was imported from a file the operator "
    "supplied to `make holdings-import`. Holdings are enrichment: they never enter a "
    "return, a risk metric or a ranking."
)
_OVERLAP_MIN_CODES: Final = 2
_OVERLAP_MAX_CODES: Final = 5


def _holdings_reason(reason: str) -> dict[str, str]:
    return {"reason": reason, "reason_description": _REASON_DESCRIPTIONS[reason]}


def _holdings_frame(scheme_code: str) -> pd.DataFrame:
    """Every stored month for one scheme, `as_of` as a plain date so the month
    arithmetic in `mf_analytics.enrich.holdings` gets dates rather than timestamps."""
    rows = query_df(
        "SELECT as_of, instrument_key, instrument_id, instrument_name, weight, quantity, "
        "market_value, sector, asset_type, source, source_url, fetched_at "
        f"FROM {holdings.TABLE.name} WHERE scheme_code = ? ORDER BY as_of, weight DESC",
        [scheme_code],
    )
    if not rows.empty:
        rows["as_of"] = pd.to_datetime(rows["as_of"]).dt.date
    return rows


@app.get("/schemes/{scheme_code}/holdings", tags=["schemes"])
def scheme_holdings(scheme_code: str) -> dict[str, Any]:
    """The latest disclosed portfolio, its concentration and splits, alongside the
    returns-based exposure fitted from NAV for the same fund.

    Both readings are always returned, and `cross_check.diverges` says when they
    disagree - a filed portfolio the style basis cannot explain, or a basis that
    explains a fund the filing says is not equity-oriented. Neither is hidden in favour
    of the other: the disagreement is the information.
    """
    _scheme_or_404(scheme_code)
    rows = _holdings_frame(scheme_code)
    fund, factors, names = _style_basis(scheme_code)
    fit = style_exposure(fund, factors)
    returns_based = {
        "weights": _exposure_weights(fit, names),
        "r_squared": fit.r_squared,
        "months": fit.months,
        "reason": fit.reason,
    }
    if rows.empty:
        return {
            "scheme_code": scheme_code,
            "as_of": None,
            **_holdings_reason(holdings.HoldingsReason.NOT_LOADED),
            "holdings": [],
            "returns_based_exposure": returns_based,
            "cross_check": None,
            "caveat": _HOLDINGS_CAVEAT,
            "disclaimer": DISCLAIMER,
        }

    as_of = max(rows["as_of"])
    latest = rows.loc[rows["as_of"] == as_of]
    return {
        "scheme_code": scheme_code,
        "as_of": as_of.isoformat(),
        "as_of_month": as_of.strftime("%Y-%m"),
        "months_available": [d.isoformat() for d in sorted(set(rows["as_of"]))],
        "stale": is_stale(as_of),
        "reason": None,
        "reason_description": None,
        **holdings.concentration(latest),
        "holdings": [
            {
                "instrument_id": None if pd.isna(r["instrument_id"]) else r["instrument_id"],
                "instrument_name": r["instrument_name"],
                "weight": float(r["weight"]),
                "quantity": None if pd.isna(r["quantity"]) else float(r["quantity"]),
                "market_value": None if pd.isna(r["market_value"]) else float(r["market_value"]),
                "sector": None if pd.isna(r["sector"]) else r["sector"],
                "asset_type": None if pd.isna(r["asset_type"]) else r["asset_type"],
            }
            for r in latest.sort_values("weight", ascending=False).to_dict("records")
        ],
        "sector_allocation": holdings.sector_allocation(latest),
        "asset_type_split": holdings.asset_type_split(latest),
        "returns_based_exposure": returns_based,
        "cross_check": holdings.exposure_cross_check(latest, fit.reason is None),
        "source": str(latest["source"].iloc[0]),
        "source_url": str(latest["source_url"].iloc[0]),
        "caveat": _HOLDINGS_CAVEAT,
        "disclaimer": DISCLAIMER,
    }


@app.get("/schemes/{scheme_code}/holdings/turnover", tags=["schemes"])
def scheme_holdings_turnover(scheme_code: str) -> dict[str, Any]:
    """Portfolio turnover between consecutive disclosure months: half the sum of
    absolute weight changes, the same convention `style_drift_3y` uses, so 0 is an
    unchanged portfolio and 1 a complete replacement."""
    _scheme_or_404(scheme_code)
    rows = _holdings_frame(scheme_code)
    if rows.empty:
        return {
            "scheme_code": scheme_code,
            "points": [],
            "latest": None,
            **_holdings_reason(holdings.HoldingsReason.NOT_LOADED),
            "caveat": _HOLDINGS_CAVEAT,
            "disclaimer": DISCLAIMER,
        }
    points, reason = holdings.turnover_series(rows)
    return {
        "scheme_code": scheme_code,
        "months_available": [d.isoformat() for d in sorted(set(rows["as_of"]))],
        "points": [p.to_dict() for p in points],
        "latest": points[-1].to_dict() if points else None,
        **(
            {"reason": None, "reason_description": None}
            if reason is None
            else _holdings_reason(reason)
        ),
        "caveat": _HOLDINGS_CAVEAT,
        "disclaimer": DISCLAIMER,
    }


@app.get("/overlap", tags=["metrics"])
def overlap(
    codes: Annotated[str, Query(description="2 to 5 comma-separated scheme codes")],
) -> dict[str, Any]:
    """Pairwise portfolio overlap: the sum of the minimum weight per instrument both
    funds hold, as a percentage of net assets.

    Each fund's own as-of month is stated, and a pair whose two months are more than one
    month apart is refused with `holdings_as_of_months_differ` rather than reported:
    comparing a January portfolio with a June one measures five months of trading.
    """
    requested = [c.strip() for c in codes.split(",") if c.strip()]
    if not _OVERLAP_MIN_CODES <= len(requested) <= _OVERLAP_MAX_CODES:
        raise HTTPException(
            status_code=422,
            detail=(
                f"codes must name {_OVERLAP_MIN_CODES} to {_OVERLAP_MAX_CODES} scheme codes, "
                f"got {len(requested)}"
            ),
        )
    if len(set(requested)) != len(requested):
        raise HTTPException(status_code=422, detail="codes must not repeat a scheme code")

    frames: dict[str, pd.DataFrame] = {}
    funds: list[dict[str, Any]] = []
    for code in requested:
        scheme = _scheme_or_404(code)
        rows = _holdings_frame(code)
        frames[code] = rows
        as_of = None if rows.empty else max(rows["as_of"])
        funds.append(
            {
                "scheme_code": code,
                "scheme_name": scheme.get("scheme_name"),
                "as_of": None if as_of is None else as_of.isoformat(),
                "as_of_month": None if as_of is None else as_of.strftime("%Y-%m"),
                "holdings_count": 0 if as_of is None else int((rows["as_of"] == as_of).sum()),
                "stale": None if as_of is None else is_stale(as_of),
                **(
                    {"reason": None, "reason_description": None}
                    if as_of is not None
                    else _holdings_reason(holdings.HoldingsReason.NOT_LOADED)
                ),
            }
        )
    return {
        "codes": requested,
        "funds": funds,
        "pairs": [
            {**pair, "reason_description": _REASON_DESCRIPTIONS.get(pair["reason"])}
            for pair in holdings.overlap_report(frames)
        ],
        "max_as_of_gap_months": holdings.MAX_OVERLAP_MONTH_GAP,
        "caveat": _HOLDINGS_CAVEAT,
        "disclaimer": DISCLAIMER,
    }


# Paths where a query parameter the API does not know is a bug in the caller with
# real consequences. Starlette drops unknown parameters silently, so `?styles=Momentum`
# - the plural of the real `style` - returned the whole unfiltered universe ranked by
# AUM, which reads exactly like a successful screen. Everywhere else an unknown
# parameter is merely inert; on these two it silently changes what the numbers mean.
_STRICT_QUERY_PATHS: Final = frozenset({"/screen", "/export/csv"})


def _declared_query_params(path: str) -> frozenset[str]:
    for route in app.routes:
        if getattr(route, "path", None) == path:
            return frozenset(p.name for p in route.dependant.query_params)  # type: ignore[attr-defined]
    return frozenset()


@app.middleware("http")
async def _reject_unknown_query_params(request: Request, call_next: Any) -> Any:
    """Refuse a filter this API does not have, rather than answering as if unfiltered.

    Range parameters are not declared on the signature - `parse_ranges` reads them off
    the raw query string and already rejects an unknown metric - so they are allowed
    through to it and reported there.
    """
    if request.url.path in _STRICT_QUERY_PATHS:
        allowed = _declared_query_params(request.url.path)
        unknown = sorted(
            key
            for key in request.query_params
            if key not in allowed and not key.endswith(("_min", "_max"))
        )
        if unknown:
            return JSONResponse(
                status_code=422,
                content={
                    "detail": (
                        f"Unknown query parameter(s): {', '.join(unknown)}. "
                        f"This endpoint accepts: {', '.join(sorted(allowed))}, "
                        "plus <metric>_min and <metric>_max."
                    )
                },
            )
    return await call_next(request)


def cli() -> None:
    import uvicorn

    uvicorn.run(
        "mf_api.main:app", host=settings.mf_api_host, port=settings.mf_api_port, reload=False
    )
