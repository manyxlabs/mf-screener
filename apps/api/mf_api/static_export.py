"""Exports what the API would answer as static JSON, so the published site needs no server.

The answers come from the real app through FastAPI's TestClient, so a static page and a
live API can never disagree about a number. Three kinds of file:

- `global/<name>.json`: the site-wide endpoints (metadata, columns, presets, ...).
- `screen/<column>.json`: one array per column of every active scheme, all aligned by
  row, plus `screen/index.json` naming them. The browser loads only the columns a
  screen shows, filters or sorts on, never the whole 50 MB table.
- `fund/<code>.json`: every per-fund endpoint the fund, compare and basket pages read,
  for each active scheme. An endpoint that refuses a scheme is kept as its error, so the
  page shows the same reason the API would.

Floats are cut to 6 significant figures, more than any figure on the site displays: the
site has to fit GitHub Pages' 1 GB. Monthly returns are the exception: the browser
compounds them into basket figures, where rounded inputs drift past 6 figures.
"""

from __future__ import annotations

import argparse
import json
import logging
import math
import multiprocessing
import shutil
import time
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path
from typing import Any

import duckdb

from .store import query_df

GLOBAL = ("metadata", "methodology", "columns", "presets", "facets", "categories", "benchmarks")

FUND = {
    "scheme": "/schemes/{c}",
    "metrics": "/schemes/{c}/metrics",
    "nav": "/schemes/{c}/nav?frequency=monthly",
    "monthly_returns": "/schemes/{c}/monthly-returns",
    "rolling_1": "/schemes/{c}/rolling-returns?horizon=1",
    "rolling_3": "/schemes/{c}/rolling-returns?horizon=3",
    "rolling_5": "/schemes/{c}/rolling-returns?horizon=5",
    "rolling_10": "/schemes/{c}/rolling-returns?horizon=10",
    "behaviour": "/schemes/{c}/behaviour",
    "exposure": "/schemes/{c}/exposure",
    "exposure_rolling": "/schemes/{c}/exposure?rolling=true",
    "comparison": "/schemes/{c}/comparison",
    "attributes": "/schemes/{c}/attributes",
}

# The screener's two enrichment filters read scheme_attributes, which the snapshot never
# joins; exported as columns so the browser can apply them the same way.
ATTRIBUTE_COLUMNS = """
SELECT scheme_code,
       exit_load_pct AS attr_exit_load_pct,
       date_diff('day', manager_start_date, current_date) / 365.25 AS attr_manager_tenure_years
FROM scheme_attributes
"""


def compact(value: Any) -> Any:
    if isinstance(value, float):
        return float(f"{value:.6g}") if math.isfinite(value) else None
    if isinstance(value, dict):
        return {k: compact(v) for k, v in value.items()}
    if isinstance(value, list):
        return [compact(v) for v in value]
    return value


def write(path: Path, payload: Any, rounded: bool = False) -> int:
    """`rounded` means the caller already applied `compact` where it wanted it."""
    path.parent.mkdir(parents=True, exist_ok=True)
    data = payload if rounded else compact(payload)
    text = json.dumps(data, separators=(",", ":"), ensure_ascii=False, allow_nan=False)
    path.write_text(text, encoding="utf-8")
    return len(text.encode())


_client: Any = None


def _init_worker() -> None:
    global _client
    # One INFO line per request is 100,000 lines a run.
    logging.getLogger("httpx").setLevel(logging.WARNING)
    from fastapi.testclient import TestClient

    from .main import app

    _client = TestClient(app, raise_server_exceptions=False)


def _answer(path: str) -> Any:
    response = _client.get(path)
    if response.status_code == 200:
        return response.json()
    detail = response.json().get("detail") if response.content else None
    return {"error": response.status_code, "detail": detail}


EXACT = {"monthly_returns"}


def _export_fund(job: tuple[str, str]) -> int:
    code, out = job
    bundle = {
        key: answer if key in EXACT else compact(answer)
        for key, path in FUND.items()
        for answer in [_answer(path.format(c=code))]
    }
    return write(Path(out) / "fund" / f"{code}.json", bundle, rounded=True)


def _screen_table() -> Any:
    from .main import _clean_records

    frame = query_df("SELECT * FROM screen_base WHERE is_active ORDER BY scheme_code")
    try:
        frame = frame.merge(query_df(ATTRIBUTE_COLUMNS), on="scheme_code", how="left")
    except duckdb.CatalogException:  # a store that never ran enrichment has no table
        frame["attr_exit_load_pct"] = None
        frame["attr_manager_tenure_years"] = None
    return _clean_records(frame), list(frame.columns)


def run(out: Path, jobs: int, limit: int | None = None) -> dict[str, Any]:
    started = time.monotonic()
    if out.exists():
        shutil.rmtree(out)
    _init_worker()
    sizes: dict[str, int] = {}
    for name in GLOBAL:
        sizes[f"global/{name}"] = write(out / "global" / f"{name}.json", _answer(f"/{name}"))

    records, columns = _screen_table()
    for column in columns:
        sizes[f"screen/{column}"] = write(
            out / "screen" / f"{column}.json", [r[column] for r in records]
        )
    write(out / "screen" / "index.json", {"columns": columns, "count": len(records)})

    codes = [r["scheme_code"] for r in records][:limit]
    # Spawn, not fork: the parent already holds a DuckDB connection and its threads.
    context = multiprocessing.get_context("spawn")
    fund_bytes = 0
    with ProcessPoolExecutor(jobs, mp_context=context, initializer=_init_worker) as pool:
        for size in pool.map(_export_fund, [(c, str(out)) for c in codes], chunksize=16):
            fund_bytes += size
    total = sum(f.stat().st_size for f in out.rglob("*") if f.is_file())
    return {
        "schemes": len(codes),
        "fund_mb": round(fund_bytes / 1e6, 1),
        "screen_mb": round(sum(v for k, v in sizes.items() if k.startswith("screen/")) / 1e6, 1),
        "total_mb": round(total / 1e6, 1),
        "seconds": round(time.monotonic() - started),
    }


def cli() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--jobs", type=int, default=max(1, (multiprocessing.cpu_count() or 2) - 1))
    parser.add_argument(
        "--limit", type=int, help="Fund files for only the first N schemes, for a quick look"
    )
    args = parser.parse_args()
    print(json.dumps(run(args.out, args.jobs, args.limit)))


if __name__ == "__main__":
    cli()
