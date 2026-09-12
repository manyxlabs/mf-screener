"""The benchmark CSV contract, and the validation that enforces it before import.

Everything here exists to stop a bad index series reaching the metrics. The strictest
rule is `currency`: it is required and never defaulted, because a USD index silently
stamped INR would be regressed against rupee NAVs and produce an alpha, a beta and a
tracking error that are pure FX noise. Refusing the file is the only safe default.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Final

import numpy as np
import pandas as pd

from ..config import BASE_CURRENCY

REQUIRED_COLUMNS: Final = ("date", "benchmark_id", "benchmark_name", "currency")
# Preferred first: a total-return index includes dividends, so it is the only fair
# comparison for a growth-option NAV, which also reinvests them.
VALUE_COLUMNS: Final = ("total_return_index", "price")
OPTIONAL_COLUMNS: Final = ("asset_class", "source")
CURRENCY_PATTERN: Final = re.compile(r"^[A-Z]{3}$")
# Below this the series cannot support even the shortest risk window (24 months).
MIN_USEFUL_MONTHS: Final = 25


class BenchmarkCsvError(ValueError):
    """A benchmark CSV was rejected. Lists every problem found, not just the first."""


@dataclass(frozen=True, slots=True)
class SeriesReport:
    benchmark_id: str
    benchmark_name: str
    currency: str
    asset_class: str
    rows: int
    first_date: str
    last_date: str
    comparable_with_inr_funds: bool

    def to_dict(self) -> dict[str, Any]:
        return {
            "benchmark_id": self.benchmark_id,
            "benchmark_name": self.benchmark_name,
            "currency": self.currency,
            "asset_class": self.asset_class,
            "rows": self.rows,
            "first_date": self.first_date,
            "last_date": self.last_date,
            "comparable_with_inr_funds": self.comparable_with_inr_funds,
        }


@dataclass(frozen=True, slots=True)
class ValidationReport:
    path: str
    rows_read: int
    value_column: str
    series: list[SeriesReport] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "path": self.path,
            "rows_read": self.rows_read,
            "value_column": self.value_column,
            "series": [s.to_dict() for s in self.series],
            "warnings": self.warnings,
        }


def _value_column(columns: set[str], problems: list[str], warnings: list[str]) -> str:
    present = [c for c in VALUE_COLUMNS if c in columns]
    if not present:
        problems.append(f"needs one of {list(VALUE_COLUMNS)} as the index level column")
        return VALUE_COLUMNS[0]
    if len(present) > 1:
        warnings.append(
            f"both {present} are present; using '{present[0]}' because a total-return "
            "index is the like-for-like comparison for a growth-option NAV"
        )
    return present[0]


def _check_dates(raw: pd.DataFrame, problems: list[str]) -> pd.Series:
    parsed = pd.to_datetime(raw["date"], errors="coerce", format="mixed")
    bad = raw.loc[parsed.isna(), "date"]
    if len(bad):
        problems.append(
            f"{len(bad)} unparseable date(s), first at CSV line {int(bad.index[0]) + 2}: "
            f"{bad.iloc[0]!r}"
        )
    return parsed


def _check_levels(raw: pd.DataFrame, column: str, problems: list[str]) -> pd.Series:
    # Index providers publish "31,500.10". Rejecting that as non-numeric would send
    # someone hunting for a corrupt row that is in fact perfectly good data.
    levels = pd.to_numeric(raw[column].str.replace(",", "", regex=False), errors="coerce")
    bad = raw.loc[~(levels > 0) | ~np.isfinite(levels), column]
    if len(bad):
        # A zero or negative index level is not a low market, it is a broken file, and
        # compounding through one yields a -100% month that looks like a real crash.
        problems.append(
            f"{len(bad)} non-positive or non-numeric '{column}' value(s), first at CSV "
            f"line {int(bad.index[0]) + 2}: {bad.iloc[0]!r}"
        )
    return levels


def _check_currencies(raw: pd.DataFrame, problems: list[str]) -> None:
    codes = raw["currency"].astype(str).str.strip().str.upper()
    invalid = sorted({c for c in codes if not CURRENCY_PATTERN.match(c)})
    if invalid:
        problems.append(f"currency must be a 3-letter ISO code; found {invalid}")
    for bid, group in codes.groupby(raw["benchmark_id"].astype(str)):
        distinct = sorted(set(group))
        if len(distinct) > 1:
            # One id, two currencies means the reader has to guess which one the series
            # is denominated in, and every consumer would guess independently.
            problems.append(f"benchmark_id {bid!r} carries more than one currency: {distinct}")


def validate_frame(raw: pd.DataFrame, path: Path) -> tuple[pd.DataFrame, ValidationReport]:
    """Check a benchmark CSV against the contract and return it normalised.

    Raises `BenchmarkCsvError` listing every problem, so a hand-built file can be fixed
    in one pass rather than one error per run.
    """
    problems: list[str] = []
    warnings: list[str] = []
    columns = set(raw.columns)

    missing = [c for c in REQUIRED_COLUMNS if c not in columns]
    if missing:
        hint = ""
        if "currency" in missing:
            hint = (
                " - 'currency' has no default: an unlabelled foreign index would be "
                f"treated as {BASE_CURRENCY} and compared with rupee NAVs"
            )
        problems.append(f"missing required column(s) {missing}{hint}")
    value_col = _value_column(columns, problems, warnings)
    if problems:
        raise BenchmarkCsvError(f"{path.name}: " + "; ".join(problems))
    if raw.empty:
        raise BenchmarkCsvError(f"{path.name}: file has a header but no rows")

    raw = raw.reset_index(drop=True)
    dates = _check_dates(raw, problems)
    levels = _check_levels(raw, value_col, problems)
    _check_currencies(raw, problems)

    ids = raw["benchmark_id"].astype(str).str.strip()
    duplicated = pd.DataFrame({"benchmark_id": ids, "date": dates}).duplicated()
    if duplicated.any():
        first = raw.loc[duplicated, "date"].iloc[0]
        problems.append(
            f"{int(duplicated.sum())} duplicate (benchmark_id, date) row(s), first on {first!r}; "
            "an index has one level per date, so which one to keep cannot be inferred"
        )
    if problems:
        raise BenchmarkCsvError(f"{path.name}: " + "; ".join(problems))

    out = pd.DataFrame(
        {
            "benchmark_id": ids,
            "benchmark_name": raw["benchmark_name"].astype(str).str.strip(),
            "currency": raw["currency"].astype(str).str.strip().str.upper(),
            "asset_class": (
                raw["asset_class"].astype(str) if "asset_class" in columns else "Equity"
            ),
            "source": (raw["source"].astype(str) if "source" in columns else f"csv:{path.name}"),
            "date": dates,
            "price_or_total_return_index": levels,
        }
    ).sort_values(["benchmark_id", "date"], ignore_index=True)

    series: list[SeriesReport] = []
    for bid, group in out.groupby("benchmark_id", sort=True):
        names = sorted(set(group["benchmark_name"]))
        if len(names) > 1:
            warnings.append(f"benchmark_id {bid!r} has several names {names}; using {names[0]!r}")
        currency = str(group["currency"].iloc[0])
        if len(group) < 2:
            problems.append(f"benchmark_id {bid!r} has one row; a return needs at least two")
        if currency != BASE_CURRENCY:
            warnings.append(
                f"{bid} is denominated in {currency}. Fund NAVs are in {BASE_CURRENCY}, so "
                "benchmark-relative metrics for any scheme mapped to it are withheld until "
                "the series is converted to INR."
            )
        series.append(
            SeriesReport(
                benchmark_id=str(bid),
                benchmark_name=names[0],
                currency=currency,
                asset_class=str(group["asset_class"].iloc[0]),
                rows=len(group),
                first_date=str(group["date"].iloc[0].date()),
                last_date=str(group["date"].iloc[-1].date()),
                comparable_with_inr_funds=currency == BASE_CURRENCY,
            )
        )
    if problems:
        raise BenchmarkCsvError(f"{path.name}: " + "; ".join(problems))

    return out, ValidationReport(
        path=str(path), rows_read=len(out), value_column=value_col, series=series, warnings=warnings
    )


def read_and_validate(path: Path) -> tuple[pd.DataFrame, ValidationReport]:
    """Parse a benchmark CSV from disk and enforce the contract on it."""
    try:
        raw = pd.read_csv(path, dtype=str)
    except pd.errors.EmptyDataError as exc:
        raise BenchmarkCsvError(f"{path.name}: file is empty") from exc
    except pd.errors.ParserError as exc:
        raise BenchmarkCsvError(f"{path.name}: not valid CSV - {exc}") from exc
    return validate_frame(raw, path)
