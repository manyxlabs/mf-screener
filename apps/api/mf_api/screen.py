"""Screen query construction. Client input selects whitelisted columns, never SQL text."""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Any

import pandas as pd

from .columns import DEFAULT_COLUMNS, NUMERIC_BY_NAME, PINNED_COLUMNS, SELECTABLE, SORTABLE
from .store import query_df, query_scalar


class FilterError(ValueError):
    """Raised for an unknown column or malformed sort; surfaced as HTTP 400."""


@dataclass(slots=True)
class ScreenRequest:
    page: int = 1
    page_size: int = 50
    search: str | None = None
    sort: list[tuple[str, str]] = field(default_factory=lambda: [("cagr_5y", "desc")])
    columns: list[str] = field(default_factory=lambda: list(DEFAULT_COLUMNS))
    categories: list[str] = field(default_factory=list)
    sub_categories: list[str] = field(default_factory=list)
    cap_bands: list[str] = field(default_factory=list)
    styles: list[str] = field(default_factory=list)
    amcs: list[str] = field(default_factory=list)
    plans: list[str] = field(default_factory=lambda: ["Direct"])
    options: list[str] = field(default_factory=lambda: ["Growth"])
    active_only: bool = True
    ranges: dict[str, tuple[float | None, float | None]] = field(default_factory=dict)
    # T2.1: one row per fund_family_id by default - Direct/Regular and Growth/IDCW
    # variants of one fund must not each count as a separate result.
    dedupe_families: bool = True


def parse_sort(raw: str | None) -> list[tuple[str, str]]:
    """`cagr_5y:desc,sharpe_5y:desc` -> ordered (column, direction) pairs."""
    if not raw:
        return [("cagr_5y", "desc")]
    parsed: list[tuple[str, str]] = []
    for token in raw.split(","):
        name, _, direction = token.strip().partition(":")
        name = name.strip()
        direction = (direction or "desc").strip().lower()
        if name not in SORTABLE:
            raise FilterError(f"Unknown sort column: {name!r}")
        if direction not in {"asc", "desc"}:
            raise FilterError(f"Sort direction must be asc or desc, got {direction!r}")
        parsed.append((name, direction))
    return parsed or [("cagr_5y", "desc")]


def parse_columns(raw: str | None) -> list[str]:
    if not raw:
        return list(DEFAULT_COLUMNS)
    names = [c.strip() for c in raw.split(",") if c.strip()]
    unknown = [c for c in names if c not in SELECTABLE]
    if unknown:
        raise FilterError(f"Unknown columns: {unknown}")
    return [*PINNED_COLUMNS, *[c for c in names if c not in PINNED_COLUMNS]]


def parse_ranges(params: dict[str, str]) -> dict[str, tuple[float | None, float | None]]:
    """Read every `<metric>_min` / `<metric>_max` query parameter.

    An unrecognised one is rejected rather than ignored, so a typo in a saved screen
    cannot silently widen the result set.
    """
    ranges: dict[str, list[float | None]] = {}
    for key, value in params.items():
        if not (key.endswith("_min") or key.endswith("_max")):
            continue
        column, bound = key[:-4], key[-3:]
        if column not in NUMERIC_BY_NAME:
            raise FilterError(f"Unknown filterable metric: {column!r}")
        if value == "":
            continue
        try:
            number = float(value)
        except ValueError as exc:
            raise FilterError(f"{key} must be a number, got {value!r}") from exc
        if not math.isfinite(number):
            raise FilterError(f"{key} must be finite")
        ranges.setdefault(column, [None, None])[0 if bound == "min" else 1] = number
    return {k: (v[0], v[1]) for k, v in ranges.items()}


def _where(request: ScreenRequest) -> tuple[str, list[Any]]:
    clauses: list[str] = []
    params: list[Any] = []
    if request.active_only:
        clauses.append("is_active")
    for column, values in (
        ("clean_category", request.categories),
        ("clean_sub_category", request.sub_categories),
        ("cap_band", request.cap_bands),
        ("style", request.styles),
        ("amc", request.amcs),
        ("clean_plan", request.plans),
        ("clean_option", request.options),
    ):
        if values:
            clauses.append(f"{column} IN ({', '.join('?' * len(values))})")
            params.extend(values)
    if request.search:
        clauses.append("(lower(scheme_name) LIKE ? OR lower(amc) LIKE ? OR scheme_code LIKE ?)")
        needle = f"%{request.search.lower()}%"
        params.extend([needle, needle, f"%{request.search}%"])
    for column, (low, high) in request.ranges.items():
        if low is not None:
            clauses.append(f"{column} >= ?")
            params.append(low)
        if high is not None:
            clauses.append(f"{column} <= ?")
            params.append(high)
    return (" WHERE " + " AND ".join(clauses) if clauses else ""), params


def _order_by(request: ScreenRequest) -> str:
    # NULLS LAST everywhere: a missing metric must never win a ranking.
    parts = [f"{name} {direction.upper()} NULLS LAST" for name, direction in request.sort]
    parts.append("scheme_code ASC")
    return " ORDER BY " + ", ".join(parts)


def _case_rank(column: str, preferred: list[str]) -> tuple[str, list[Any]]:
    """0 for the first-preferred value seen in `preferred`, rising for the rest.

    A helper for `_family_relation`'s tie-break, not a general SQL builder: kept
    here because it only ever ranks the plan/option preference used there.
    """
    if not preferred:
        return "0", []
    whens = " ".join(f"WHEN {column} = ? THEN {i}" for i in range(len(preferred)))
    return f"CASE {whens} ELSE {len(preferred)} END", list(preferred)


def _family_relation(request: ScreenRequest, where: str) -> tuple[str, list[Any]]:
    """`screen_base`, one row per fund_family_id: filters first, then one winner per
    family among the surviving rows, so a filter narrowing to a single plan or option
    still returns one row per fund rather than reintroducing its other variants.

    Preference order: whichever of the request's own plan/option filters lists a value
    first, then the Direct/Growth convention, then scheme_code for a stable pick when
    a data anomaly leaves two rows tied on everything else.
    """
    if not request.dedupe_families:
        return f"screen_base{where}", []
    plan_case, plan_params = _case_rank("clean_plan", request.plans)
    option_case, option_params = _case_rank("clean_option", request.options)
    rank_expr = (
        "ROW_NUMBER() OVER (PARTITION BY fund_family_id ORDER BY "
        f"{plan_case}, {option_case}, "
        "CASE WHEN clean_plan = 'Direct' THEN 0 ELSE 1 END, "
        "CASE WHEN clean_option = 'Growth' THEN 0 ELSE 1 END, "
        "scheme_code)"
    )
    inner = f"SELECT *, {rank_expr} AS family_rank FROM screen_base{where}"
    return f"(SELECT * FROM ({inner}) fam WHERE family_rank = 1)", [*plan_params, *option_params]


def run_screen(request: ScreenRequest) -> tuple[pd.DataFrame, int]:
    where, where_params = _where(request)
    relation, rank_params = _family_relation(request, where)
    params = [*rank_params, *where_params]
    total = int(query_scalar(f"SELECT count(*) FROM {relation}", params))
    offset = (request.page - 1) * request.page_size
    cols = ", ".join(request.columns)
    sql = f"SELECT {cols} FROM {relation}{_order_by(request)} LIMIT ? OFFSET ?"
    frame = query_df(sql, [*params, request.page_size, offset])
    return frame, total


def run_export(request: ScreenRequest, limit: int = 50_000) -> pd.DataFrame:
    where, where_params = _where(request)
    relation, rank_params = _family_relation(request, where)
    params = [*rank_params, *where_params]
    sql = f"SELECT {', '.join(request.columns)} FROM {relation}{_order_by(request)} LIMIT ?"
    return query_df(sql, [*params, limit])
