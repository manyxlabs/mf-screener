"""Reference answers for static-screen's /search and /schemes parity check.

Runs the API's own handlers over an in-memory copy of only the schemes the static export
holds, so any difference left is the TypeScript port's, not the smaller universe's.
Reads `[{"path": "search" | "schemes", "params": {...}}, ...]` on stdin and writes the
answers, in order, as JSON on stdout: one /schemes answer, or every distinct /search
answer DuckDB gave over several runs. The store is attached read-only.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

import duckdb

import mf_api.main as main
from mf_analytics.config import get_settings
from mf_analytics.db import refresh_search_index

SEARCH_RUNS = 8
SCHEMES_DEFAULTS = {"q": None, "sub_category": None, "amc": None, "limit": 50, "offset": 0}
EXPORT = Path(__file__).resolve().parents[1] / "public" / "data" / "screen" / "scheme_code.json"


def run() -> None:
    codes = json.loads(EXPORT.read_text())
    con = duckdb.connect()
    con.execute(f"ATTACH '{get_settings().mf_duckdb_path}' AS src (READ_ONLY)")
    con.execute("CREATE TABLE codes AS SELECT unnest(?::VARCHAR[]) AS scheme_code", [codes])
    con.execute(
        "CREATE TABLE scheme_master AS SELECT * FROM src.scheme_master "
        "WHERE scheme_code IN (SELECT scheme_code FROM codes)"
    )
    con.execute("CREATE TABLE scheme_ter AS SELECT * FROM src.scheme_ter")
    con.execute("DETACH src")
    refresh_search_index(con)

    def query_df(sql: str, params: list[Any] | None = None) -> Any:
        return con.execute(sql, params or []).fetch_df()

    def query_scalar(sql: str, params: list[Any] | None = None) -> Any:
        return con.execute(sql, params or []).fetchone()[0]  # type: ignore[index]

    main.query_df = query_df  # type: ignore[assignment]
    main.query_scalar = query_scalar  # type: ignore[assignment]

    def answer(job: dict[str, Any]) -> Any:
        if job["path"] == "schemes":
            return main.schemes(**{**SCHEMES_DEFAULTS, **job["params"]})
        # bm25 sums run in parallel, so families tied in exact arithmetic come back in an
        # order that varies run to run: collect the distinct answers DuckDB gives.
        answers: list[Any] = []
        for _ in range(SEARCH_RUNS):
            result = main.search(**job["params"])
            if result not in answers:
                answers.append(result)
        return answers

    out = [answer(job) for job in json.load(sys.stdin)]
    json.dump(out, sys.stdout, default=str)


if __name__ == "__main__":
    run()
