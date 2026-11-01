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
site has to fit GitHub Pages' 1 GB. `EXACT` lists the exceptions.
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


# Left unrounded: NAVs are shown to 4 decimals (a 4281.8909 NAV would print 4281.8900),
# and the browser compounds monthly returns into basket figures, where rounded inputs
# drift past 6 figures.
EXACT = {"nav", "latest_nav", "monthly_returns"}


def compact(value: Any) -> Any:
    if isinstance(value, float):
        return float(f"{value:.6g}") if math.isfinite(value) else None
    if isinstance(value, dict):
        return {k: v if k in EXACT else compact(v) for k, v in value.items()}
    if isinstance(value, list):
        return [compact(v) for v in value]
    return value


def write(path: Path, payload: Any) -> int:
    path.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(payload, separators=(",", ":"), ensure_ascii=False, allow_nan=False)
    path.write_text(text, encoding="utf-8")
    return len(text.encode())


_client: Any = None


def _init_worker() -> None:
    global _client
    # One INFO line per request is 100,000 lines a run.
    logging.getLogger("httpx2").setLevel(logging.WARNING)
    from fastapi.testclient import TestClient

    from .main import app

    _client = TestClient(app, raise_server_exceptions=False)


def _answer(path: str) -> Any:
    response = _client.get(path)
    if response.status_code == 200:
        return response.json()
    # A refusal is part of the answer; a server error is a bug, and baking it into the
    # site would publish it as if it were the scheme's data.
    if response.status_code >= 500:
        raise RuntimeError(f"GET {path}: {response.status_code} {response.text[:500]}")
    detail = response.json().get("detail") if response.content else None
    return {"error": response.status_code, "detail": detail}


def _export_fund(job: tuple[str, str]) -> int:
    code, out = job
    bundle = {key: _answer(path.format(c=code)) for key, path in FUND.items()}
    return write(Path(out) / "fund" / f"{code}.json", compact(bundle))


def _screen_table() -> Any:
    from .main import _clean_records

    frame = query_df("SELECT * FROM screen_base WHERE is_active ORDER BY scheme_code")
    try:
        frame = frame.merge(query_df(ATTRIBUTE_COLUMNS), on="scheme_code", how="left")
    except duckdb.CatalogException:  # a store that never ran enrichment has no table
        frame["attr_exit_load_pct"] = None
        frame["attr_manager_tenure_years"] = None
    return _clean_records(frame), list(frame.columns)


def _column(values: list[Any]) -> Any:
    """A column of objects repeats a few hundred distinct values over thousands of rows
    (missing_reasons is 29 MB plain), so it is stored once per value plus a row index."""
    if not any(isinstance(v, dict) for v in values):
        return values
    # Key order is kept: the CSV writes each object as JSON text, as the API does.
    keys = [json.dumps(v) for v in values]
    index = {k: i for i, k in enumerate(dict.fromkeys(keys))}
    return {"distinct": [json.loads(k) for k in index], "rows": [index[k] for k in keys]}


def run(out: Path, jobs: int, limit: int | None = None) -> dict[str, Any]:
    started = time.monotonic()
    if out.exists():
        shutil.rmtree(out)
    _init_worker()
    sizes: dict[str, int] = {}
    for name in GLOBAL:
        sizes[f"global/{name}"] = write(
            out / "global" / f"{name}.json", compact(_answer(f"/{name}"))
        )

    records, columns = _screen_table()
    for column in columns:
        values = [r[column] for r in records]
        sizes[f"screen/{column}"] = write(
            out / "screen" / f"{column}.json",
            _column(values if column in EXACT else compact(values)),
        )
    write(out / "screen" / "index.json", {"columns": columns, "count": len(records)})

    # Every active scheme gets a page, not only those in the screener: a scheme with no
    # metrics snapshot is still linked as a peer and has its own "no metrics" page.
    active = query_df("SELECT scheme_code FROM scheme_master WHERE is_active ORDER BY 1")
    codes = [str(c) for c in active["scheme_code"]][:limit]
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
