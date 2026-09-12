"""Command line entry points behind the Makefile targets."""

from __future__ import annotations

import json
from datetime import UTC, datetime
from pathlib import Path
from typing import Annotated, Any

import typer

from .config import get_settings
from .db import StoreLockedError, connect, init_schema, scalar
from .enrich import holdings
from .ingest import benchmarks, master, nav, sample, ter
from .ingest.nav import register_nav_view
from .logging_setup import configure_logging
from .pipeline import fund_family_grouping_summary
from .pipeline import run as run_metrics
from .quality import enrichment_coverage_and_staleness
from .sources.tigzig import (
    MASTER_COLUMN_MAP,
    NAV_COLUMN_MAP,
    TigZigSource,
    inspect_parquet,
    sample_rows,
)

app = typer.Typer(add_completion=False, help="Indian mutual fund screener data pipeline")


@app.callback()
def main() -> None:
    configure_logging()


@app.command("init")
def init() -> None:
    """Create data directories and the DuckDB schema."""
    s = get_settings()
    s.ensure_dirs()
    with connect(s) as con:
        init_schema(con)
    typer.echo(f"Initialised {s.mf_duckdb_path}")


@app.command("inspect-schema")
def inspect_schema() -> None:
    """Print the provider's live schema, and save it with example rows for the record.

    The saved artefact is what a later reader checks a field name against: the source
    is a live third-party API, so what it published on the day the mapping was written
    is otherwise unrecoverable.
    """
    s = get_settings()
    s.ensure_dirs()
    source = TigZigSource(s)
    catalog = source.catalog()
    schema = catalog.get("schema", {})
    record: dict[str, Any] = {
        "inspected_at": datetime.now(UTC).replace(tzinfo=None).isoformat(),
        "provider_base": s.mf_api_base,
        "openapi": source.openapi(),
        "catalog": catalog,
        "manifest": source.manifest(),
        "column_maps": {"master": MASTER_COLUMN_MAP, "nav": NAV_COLUMN_MAP},
        "downloaded_files": {},
    }
    typer.echo(f"Provider: {s.mf_api_base}")
    for block, expected in (("latest_snapshot", MASTER_COLUMN_MAP), ("nav_master", NAV_COLUMN_MAP)):
        columns = schema.get(block, {}).get("columns", [])
        typer.echo(f"\n== {block} ({len(columns)} source columns) ==")
        for col in columns:
            target = expected.get(col)
            typer.echo(f"  {col:26s} -> {target or '(unused)'}")
        missing = sorted(set(expected) - set(columns))
        if missing:
            typer.secho(f"  MISSING from source: {missing}", fg=typer.colors.RED)
    typer.echo("\n== download manifest ==")
    for name, info in record["manifest"].get("files", {}).items():
        marker = " <- MF_NAV_FORMAT" if info.get("format") == s.mf_nav_format else ""
        marker += " <- MF_MASTER_FORMAT" if info.get("format") == s.mf_master_format else ""
        typer.echo(
            f"  {name:34s} {info.get('size_human', '?'):>10s}  rows={info.get('row_count')}{marker}"
        )

    # The catalog says what the provider intends to publish; the file on disk is what
    # the pipeline actually reads. Print both so drift between them is visible.
    for kind, path in (
        ("scheme master", s.raw_dir / f"scheme_master.{s.mf_master_format}"),
        ("nav history", s.raw_dir / f"nav_history.{s.mf_nav_format}"),
    ):
        typer.echo(f"\n== downloaded {kind}: {path.name} ==")
        if not path.exists():
            typer.echo("  not downloaded yet")
            continue
        info = inspect_parquet(path)
        info["example_rows"] = sample_rows(path)
        record["downloaded_files"][kind] = info
        typer.echo(
            f"  {info['num_rows']:,} rows in {info['num_row_groups']} row groups, "
            f"{info['file_bytes'] / 1e6:.1f} MB, written by {info['created_by']}"
        )
        for col, dtype in info["columns"].items():
            typer.echo(f"  {col:26s} {dtype}")
        if info["example_rows"]:
            typer.echo(f"  example row: {json.dumps(info['example_rows'][0], default=str)}")

    out = s.raw_dir / "source_inspection.json"
    out.write_text(json.dumps(record, indent=2, default=str))
    typer.echo(f"\nSaved the live OpenAPI spec, catalog, manifest and example rows to {out}")


@app.command("data-master")
def data_master(
    force: Annotated[bool, typer.Option(help="Re-download even if unchanged")] = False,
) -> None:
    """Download and normalise the scheme master."""
    typer.echo(json.dumps(master.run(force=force), indent=2, default=str))


@app.command("data-nav")
def data_nav(
    force: Annotated[bool, typer.Option(help="Re-download even if unchanged")] = False,
) -> None:
    """Download and normalise the full NAV history (~170 MB)."""
    typer.echo(json.dumps(nav.run(force=force), indent=2, default=str))


@app.command("provenance")
def provenance() -> None:
    """Show the raw artefacts the local store was built from, with their checksums."""
    with connect(get_settings()) as con:
        init_schema(con)
        rows = con.execute(
            "SELECT kind, path, format, bytes, sha256, etag, last_modified, "
            "file_row_count, ingested_rows, ingested_at FROM raw_file ORDER BY kind"
        ).df()
    typer.echo(rows.to_string(index=False) if len(rows) else "No raw files recorded yet.")


@app.command("data-sample")
def data_sample(per_sub_category: int = 8) -> None:
    """Build a small representative development dataset."""
    typer.echo(json.dumps(sample.run(per_sub_category=per_sub_category), indent=2, default=str))


@app.command("data-refresh")
def data_refresh(days: int = 45) -> None:
    """Top up recent NAVs, falling back to a full download when needed."""
    typer.echo(json.dumps(nav.refresh_recent(days=days), indent=2, default=str))


@app.command("metrics-build")
def metrics_build() -> None:
    """Compute category series and the per-scheme metrics snapshot."""
    typer.echo(json.dumps(run_metrics(), indent=2, default=str))


@app.command("benchmark-validate")
def benchmark_validate(
    file: Annotated[Path, typer.Option(exists=True, help="CSV to check")],
) -> None:
    """Check a benchmark CSV against the import contract without loading it."""
    typer.echo(json.dumps(benchmarks.validate_csv(file), indent=2, default=str))


@app.command("benchmark-import")
def benchmark_import(
    file: Annotated[Path, typer.Option(exists=True, help="CSV to import")],
) -> None:
    """Validate and import a benchmark index CSV."""
    info = benchmarks.import_csv(file)
    typer.echo(json.dumps(info, indent=2, default=str))
    for warning in info.get("warnings", []):
        typer.secho(f"warning: {warning}", fg=typer.colors.YELLOW, err=True)


@app.command("holdings-validate")
def holdings_validate(
    file: Annotated[Path, typer.Option(exists=True, help="CSV to check")],
) -> None:
    """Check a holdings CSV against the import contract without loading it."""
    info = holdings.validate_csv(file)
    typer.echo(json.dumps(info, indent=2, default=str))
    for warning in info["warnings"]:
        typer.secho(f"warning: {warning}", fg=typer.colors.YELLOW, err=True)


@app.command("holdings-import")
def holdings_import(
    file: Annotated[Path, typer.Option(exists=True, help="CSV to import")],
) -> None:
    """Validate and import a scheme holdings CSV."""
    info = holdings.import_csv(file)
    typer.echo(json.dumps(info, indent=2, default=str))
    for warning in info["warnings"]:
        typer.secho(f"warning: {warning}", fg=typer.colors.YELLOW, err=True)


@app.command("benchmark-coverage")
def benchmark_coverage() -> None:
    """Show what the loaded benchmarks cover and where that coverage falls short."""
    with connect(get_settings()) as con:
        init_schema(con)
        info = benchmarks.coverage_report(lambda sql: con.execute(sql).fetch_df())
    typer.echo(json.dumps(info, indent=2, default=str))
    for warning in info["warnings"]:
        typer.secho(f"warning: {warning}", fg=typer.colors.YELLOW, err=True)


@app.command("style-basis")
def style_basis() -> None:
    """Build the style-factor proxies that returns-based exposure is fitted against."""
    typer.echo(json.dumps(benchmarks.build_style_basis(), indent=2, default=str))


@app.command("benchmark-proxy")
def benchmark_proxy(
    scheme_code: str,
    benchmark_id: str,
    benchmark_name: str,
    asset_class: str = "Equity",
) -> None:
    """Build a clearly-labelled benchmark proxy from an index fund's NAV series."""
    info = benchmarks.build_index_fund_proxy(
        scheme_code, benchmark_id, benchmark_name, asset_class=asset_class
    )
    typer.echo(json.dumps(info, indent=2, default=str))


@app.command("benchmark-map")
def benchmark_map() -> None:
    """Apply the sub-category -> benchmark mapping config."""
    typer.echo(json.dumps(benchmarks.apply_mapping(), indent=2, default=str))


@app.command("ter-import")
def ter_import() -> None:
    """Refresh expense ratios from the configured TER source and report the coverage."""
    info = ter.run(get_settings())
    typer.echo(json.dumps(info, indent=2, default=str))
    if info["active_coverage_pct"] < 100:
        typer.secho(
            f"warning: {info['active_schemes'] - info['matched_active_schemes']} active schemes "
            "have no published TER and will show a blank expense ratio.",
            fg=typer.colors.YELLOW,
            err=True,
        )


@app.command("validate")
def validate() -> None:
    """Report row counts, coverage and data-quality warnings for the local store."""
    s = get_settings()
    with connect(s) as con:
        init_schema(con)
        register_nav_view(con, s)
        checks = {
            "scheme_master": "SELECT count(*) FROM scheme_master",
            "nav_daily": "SELECT count(*) FROM nav_daily",
            "nav_monthly": "SELECT count(*) FROM nav_monthly",
            "monthly_returns": "SELECT count(*) FROM monthly_returns",
            "rolling_returns_monthly": "SELECT count(*) FROM rolling_returns_monthly",
            "nav_zero_excluded": "SELECT count(*) FROM nav_zero_excluded",
            "benchmarks": "SELECT count(*) FROM benchmarks",
            "scheme_benchmark_map": "SELECT count(*) FROM scheme_benchmark_map",
            "scheme_metrics_snapshot": "SELECT count(*) FROM scheme_metrics_snapshot",
            "raw_files_recorded": "SELECT count(*) FROM raw_file",
            "nav_rows_without_checksum": (
                "SELECT CASE WHEN (SELECT count(*) FROM raw_file WHERE kind = 'nav_history') = 0 "
                "THEN (SELECT count(*) FROM nav_daily) ELSE 0 END"
            ),
            "schemes_without_nav": (
                "SELECT count(*) FROM scheme_master m "
                "WHERE NOT EXISTS (SELECT 1 FROM nav_monthly n WHERE n.scheme_code = m.scheme_code)"
            ),
            "duplicate_nav_rows": (
                "SELECT count(*) FROM (SELECT scheme_code, date FROM nav_daily "
                "GROUP BY 1, 2 HAVING count(*) > 1)"
            ),
            "unclassified_sub_category": (
                "SELECT count(*) FROM scheme_master WHERE clean_sub_category = 'Unclassified'"
            ),
        }
        results = {name: int(scalar(con, sql)) for name, sql in checks.items()}
        coverage = benchmarks.coverage_report(lambda sql: con.execute(sql).fetch_df())
        family_summary = fund_family_grouping_summary(con)
        enrichment_report = enrichment_coverage_and_staleness(con, results["scheme_master"])
    results["schemes_without_benchmark"] = coverage["schemes_unmapped"]
    results["benchmarks_not_in_inr"] = sum(
        1 for b in coverage["benchmarks"] if not b["comparable_with_inr_funds"]
    )
    typer.echo(json.dumps(results, indent=2))
    typer.echo(json.dumps({"fund_family_grouping": family_summary}, indent=2))
    typer.echo(json.dumps({"enrichment_coverage": enrichment_report}, indent=2, default=str))
    for warning in coverage["warnings"]:
        typer.secho(f"warning: {warning}", fg=typer.colors.YELLOW, err=True)
    if results["duplicate_nav_rows"]:
        raise typer.Exit(code=1)


def main_cli() -> None:
    """Entry point that reports a locked store or a rejected CSV as advice, not a traceback."""
    try:
        app()
    except (StoreLockedError, benchmarks.BenchmarkCsvError, holdings.HoldingsCsvError) as exc:
        typer.secho(str(exc), fg=typer.colors.RED, err=True)
        raise SystemExit(1) from None


if __name__ == "__main__":
    main_cli()
