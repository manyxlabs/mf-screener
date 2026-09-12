"""The holdings CSV contract, and the validation that enforces it before import.

This project ships no holdings data and fetches none: the candidate source is
unreachable (see `docs/data-policy.md`), so the only way rows reach `scheme_holdings`
is a file the operator supplies. That makes this contract the whole guard, and the
strictest rule in it is the unit of `weight`: a fraction of net assets, never a
percentage. A file of percentages imported as fractions would report a fund as 4,500%
invested, and every overlap figure computed from it would be a hundred times too large
while still looking like a plausible number, so a file that looks like percentages is
refused with the correction rather than converted on the reader's behalf.

Everything is checked before anything is written, and every problem is reported at
once with its CSV line number, so a hand-built file is fixable in one pass.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Final

import pandas as pd

REQUIRED_COLUMNS: Final = ("scheme_code", "as_of", "instrument_name", "weight")
OPTIONAL_COLUMNS: Final = ("instrument_id", "quantity", "market_value", "sector", "asset_type")
# The four kinds a weight can be. Anything else is refused rather than stored, because
# the asset-type split and the returns-based cross-check both read this column and an
# unrecognised label would silently drop out of both totals.
ASSET_TYPES: Final = ("equity", "debt", "cash", "derivative")

# A little slack for a file that rounds each weight to two decimals: 100 holdings each
# rounded up by 0.00005 is 0.005, and a published portfolio rarely lists more.
MAX_WEIGHT_SUM: Final = 1.02
# Below this the file is missing something real - but cash is often simply left out of
# a published portfolio, so it is a warning, not a refusal.
MIN_WEIGHT_SUM_WARN: Final = 0.90
# A scheme-month whose every weight is in [1, 100] and which sums into this band is a
# percent file, not a fund that is 4,500% invested.
PERCENT_SUM_RANGE: Final = (95.0, 105.0)
# How many offending line numbers a single problem lists before it stops counting.
MAX_LINES_LISTED: Final = 10


class HoldingsCsvError(ValueError):
    """A holdings CSV was rejected. Lists every problem found, not just the first."""


@dataclass(frozen=True, slots=True)
class SchemeMonthReport:
    scheme_code: str
    as_of: str
    holdings: int
    weight_sum: float
    top_10_concentration: float

    def to_dict(self) -> dict[str, Any]:
        return {
            "scheme_code": self.scheme_code,
            "as_of": self.as_of,
            "holdings": self.holdings,
            "weight_sum": self.weight_sum,
            "top_10_concentration": self.top_10_concentration,
        }


@dataclass(frozen=True, slots=True)
class ValidationReport:
    path: str
    rows_read: int
    scheme_months: list[SchemeMonthReport] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "path": self.path,
            "rows_read": self.rows_read,
            "scheme_months": [s.to_dict() for s in self.scheme_months],
            "warnings": self.warnings,
        }


def _lines(index: pd.Index) -> str:
    """CSV line numbers for a set of frame positions: row 0 is line 2, after the header."""
    numbers = [int(i) + 2 for i in index]
    shown = ", ".join(str(n) for n in numbers[:MAX_LINES_LISTED])
    return (
        shown
        if len(numbers) <= MAX_LINES_LISTED
        else f"{shown} and {len(numbers) - MAX_LINES_LISTED} more"
    )


def _numeric(series: pd.Series) -> pd.Series:
    """Coerce a text column to float, tolerating the thousands separators a spreadsheet
    export writes. A '%' sign is deliberately not stripped: it means the file is in
    percent, which is a rejection with its own message, not a formatting quirk."""
    return pd.to_numeric(series.fillna("").str.replace(",", "", regex=False), errors="coerce")


def _optional_numeric(raw: pd.DataFrame, column: str) -> pd.Series:
    """An absent optional column becomes a typed all-null column, not an object column
    of `pd.NA` - DuckDB cannot infer a type from the latter when the frame is inserted."""
    if column not in raw.columns:
        return pd.Series(float("nan"), index=raw.index, dtype="float64")
    return _numeric(raw[column])


def _optional_text(raw: pd.DataFrame, column: str) -> pd.Series:
    if column not in raw.columns:
        return pd.Series(pd.NA, index=raw.index, dtype="string")
    values = raw[column].astype("string").str.strip()
    return values.where(values.notna() & (values != ""), pd.NA)


def _month_label(month: Any) -> str:
    return str(pd.Timestamp(month).date())


def _month_end(parsed: pd.Series) -> pd.Series:
    """Holdings are a monthly photograph, so every as_of collapses to its month end.
    Two files disclosing the same month on different days must land on one snapshot,
    or a turnover figure would diff a portfolio against itself."""
    return parsed.dt.to_period("M").dt.to_timestamp("M")


def _check_as_of(raw: pd.DataFrame, problems: list[str]) -> pd.Series:
    parsed = pd.to_datetime(raw["as_of"], errors="coerce", format="mixed")
    bad = raw.loc[parsed.isna(), "as_of"]
    if len(bad):
        problems.append(
            f"{len(bad)} unparseable as_of value(s) at CSV line(s) {_lines(bad.index)}: "
            f"first is {bad.iloc[0]!r}"
        )
    return parsed


def _check_asset_types(raw: pd.DataFrame, problems: list[str]) -> pd.Series:
    if "asset_type" not in raw.columns:
        return pd.Series(pd.NA, index=raw.index, dtype="string")
    normalised = raw["asset_type"].astype("string").str.strip().str.lower()
    unknown = normalised.notna() & (normalised != "") & ~normalised.isin(ASSET_TYPES)
    if unknown.any():
        found = sorted(set(normalised[unknown]))
        problems.append(
            f"{int(unknown.sum())} row(s) at CSV line(s) {_lines(raw.index[unknown])} carry an "
            f"asset_type outside {list(ASSET_TYPES)}: {found}. The asset-type split and the "
            "returns-based cross-check both read this column, so an unrecognised label would "
            "silently vanish from both totals"
        )
    return normalised.where(normalised.notna() & (normalised != ""), pd.NA)


def _percent_scheme_months(groups: Any) -> set[tuple[Any, Any]]:
    """The (scheme_code, as_of) pairs whose weights are plainly percentages."""
    found: set[tuple[Any, Any]] = set()
    low, high = PERCENT_SUM_RANGE
    for key, group in groups:
        weights = group["weight"]
        if weights.isna().any():
            continue
        if bool(weights.between(1.0, 100.0).all()) and low <= float(weights.sum()) <= high:
            found.add((key[0], key[1]))
    return found


def validate_frame(
    raw: pd.DataFrame, path: Path, known_scheme_codes: set[str] | None = None
) -> tuple[pd.DataFrame, ValidationReport]:
    """Check a holdings CSV against the contract and return it normalised.

    Raises `HoldingsCsvError` listing every problem, so a hand-built file can be fixed
    in one pass rather than one error per run. `known_scheme_codes` is the store's
    `scheme_master`; a code absent from it is refused, because holdings attached to a
    scheme this app has never heard of can never be displayed or overlapped.
    """
    problems: list[str] = []
    warnings: list[str] = []

    missing = [c for c in REQUIRED_COLUMNS if c not in raw.columns]
    if missing:
        raise HoldingsCsvError(
            f"{path.name}: missing required column(s) {missing}. Required: "
            f"{list(REQUIRED_COLUMNS)}; optional: {list(OPTIONAL_COLUMNS)}"
        )
    if raw.empty:
        raise HoldingsCsvError(f"{path.name}: file has a header but no rows")

    raw = raw.reset_index(drop=True)
    as_of = _check_as_of(raw, problems)
    asset_type = _check_asset_types(raw, problems)
    scheme_code = raw["scheme_code"].astype("string").str.strip()
    instrument_name = raw["instrument_name"].astype("string").str.strip()
    instrument_id = _optional_text(raw, "instrument_id")

    blank_name = instrument_name.isna() | (instrument_name == "")
    if blank_name.any():
        problems.append(
            f"{int(blank_name.sum())} row(s) at CSV line(s) {_lines(raw.index[blank_name])} "
            "have a blank instrument_name; a holding with neither an id nor a name cannot be "
            "matched against another fund's"
        )

    weight = _numeric(raw["weight"])
    non_numeric = weight.isna()
    if non_numeric.any():
        problems.append(
            f"{int(non_numeric.sum())} non-numeric weight(s) at CSV line(s) "
            f"{_lines(raw.index[non_numeric])}: first is {raw.loc[non_numeric, 'weight'].iloc[0]!r}"
        )
    negative = weight < 0
    if negative.any():
        problems.append(
            f"{int(negative.sum())} negative weight(s) at CSV line(s) {_lines(raw.index[negative])}"
        )

    frame = pd.DataFrame(
        {
            "scheme_code": scheme_code,
            "as_of": as_of,
            "instrument_id": instrument_id,
            "instrument_name": instrument_name,
            "weight": weight,
        }
    )
    groups = frame.loc[as_of.notna()].groupby(["scheme_code", "as_of"], sort=True)
    percent_months = _percent_scheme_months(groups)
    for code, month in sorted(percent_months, key=lambda kv: (str(kv[0]), str(kv[1]))):
        rows = frame.index[(frame["scheme_code"] == code) & (frame["as_of"] == month)]
        total = float(frame.loc[rows, "weight"].sum())
        problems.append(
            f"scheme {code} for {_month_label(month)} is a percent file: every one of its "
            f"{len(rows)} weights is between 1 and 100 and they sum to {total:.2f}. Weight is a "
            "fraction of net assets, so divide this scheme-month's weights by 100 and re-import. "
            f"Nothing is converted for you. CSV line(s) {_lines(rows)}"
        )

    in_percent_month = pd.Series(
        list(zip(frame["scheme_code"], frame["as_of"], strict=True)), index=frame.index
    ).isin(percent_months)
    above_one = (weight > 1.0) & ~in_percent_month
    if above_one.any():
        problems.append(
            f"{int(above_one.sum())} weight(s) above 1 at CSV line(s) "
            f"{_lines(raw.index[above_one])}: weight is a fraction of net assets, not a "
            "percentage, so 4.5% of the portfolio is 0.045 and never 4.5"
        )

    # The identity a holding is deduplicated and matched on: the published id where the
    # file carries one, the name otherwise. Mixing the two within a fund is the file's
    # choice, and the missing-id warning below is what says so.
    instrument_key = instrument_id.where(instrument_id.notna(), instrument_name)
    duplicated = pd.DataFrame(
        {"scheme_code": scheme_code, "as_of": as_of, "instrument_key": instrument_key}
    ).duplicated(keep=False)
    if duplicated.any():
        problems.append(
            f"{int(duplicated.sum())} duplicate (scheme_code, as_of, instrument) row(s) at CSV "
            f"line(s) {_lines(raw.index[duplicated])}; one fund holds one line per instrument per "
            "month, so which weight to keep cannot be inferred"
        )

    if known_scheme_codes is not None:
        unknown = ~scheme_code.isin(known_scheme_codes)
        if unknown.any():
            problems.append(
                f"{int(unknown.sum())} row(s) at CSV line(s) {_lines(raw.index[unknown])} name a "
                "scheme_code that is not in scheme_master: "
                f"{sorted(set(scheme_code[unknown]))[:10]}"
            )

    over_weight = [
        (code, month, float(group["weight"].sum()))
        for (code, month), group in groups
        if (code, month) not in percent_months and float(group["weight"].sum()) > MAX_WEIGHT_SUM
    ]
    for code, month, total in over_weight:
        problems.append(
            f"scheme {code} for {_month_label(month)} has weights summing to {total:.4f}, "
            f"above the {MAX_WEIGHT_SUM} ceiling; a portfolio cannot be more than fully invested "
            "once rounding is allowed for"
        )

    if problems:
        raise HoldingsCsvError(f"{path.name}: " + "; ".join(problems))

    no_id = instrument_id.isna()
    if no_id.any():
        warnings.append(
            f"{int(no_id.sum())} holding(s) carry no instrument_id and are matched by name alone, "
            "so they will only overlap against another fund that names them identically. "
            f"CSV line(s) {_lines(raw.index[no_id])}"
        )

    out = pd.DataFrame(
        {
            "scheme_code": scheme_code.astype(str),
            "as_of": _month_end(as_of).dt.date,
            "instrument_key": instrument_key.astype(str),
            "instrument_id": instrument_id,
            "instrument_name": instrument_name.astype(str),
            "weight": weight.astype(float),
            "quantity": _optional_numeric(raw, "quantity"),
            "market_value": _optional_numeric(raw, "market_value"),
            "sector": _optional_text(raw, "sector"),
            "asset_type": asset_type,
        }
    ).sort_values(
        ["scheme_code", "as_of", "weight"], ascending=[True, True, False], ignore_index=True
    )

    scheme_months: list[SchemeMonthReport] = []
    for (code, month), group in out.groupby(["scheme_code", "as_of"], sort=True):
        total = float(group["weight"].sum())
        if total < MIN_WEIGHT_SUM_WARN:
            warnings.append(
                f"scheme {code} for {month} has weights summing to {total:.4f}, below "
                f"{MIN_WEIGHT_SUM_WARN}. Cash is often omitted from a published portfolio, so "
                "this is reported rather than refused - but concentration and overlap for this "
                "scheme-month are computed against the weights that are present, not against 1"
            )
        scheme_months.append(
            SchemeMonthReport(
                scheme_code=str(code),
                as_of=str(month),
                holdings=len(group),
                weight_sum=round(total, 6),
                top_10_concentration=round(float(group["weight"].nlargest(10).sum()), 6),
            )
        )

    return out, ValidationReport(
        path=str(path), rows_read=len(out), scheme_months=scheme_months, warnings=warnings
    )


def read_and_validate(
    path: Path, known_scheme_codes: set[str] | None = None
) -> tuple[pd.DataFrame, ValidationReport]:
    """Parse a holdings CSV from disk and enforce the contract on it."""
    try:
        raw = pd.read_csv(path, dtype=str)
    except pd.errors.EmptyDataError as exc:
        raise HoldingsCsvError(f"{path.name}: file is empty") from exc
    except pd.errors.ParserError as exc:
        raise HoldingsCsvError(f"{path.name}: not valid CSV - {exc}") from exc
    return validate_frame(raw, path, known_scheme_codes)
