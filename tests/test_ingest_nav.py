"""Canonical NAV lake: partition promotion, deduplication and schema validation."""

from __future__ import annotations

from datetime import date
from pathlib import Path

import duckdb
import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq
import pytest

from mf_analytics.config import Settings
from mf_analytics.db import init_schema
from mf_analytics.ingest.nav import (
    nav_dataset_dir,
    refresh_monthly_tables,
    register_nav_view,
    write_nav_dataset,
)
from mf_analytics.pipeline import load_series
from mf_analytics.sources.base import SchemaMismatchError
from mf_analytics.sources.tigzig import TigZigSource


@pytest.fixture
def settings(tmp_path: Path) -> Settings:
    s = Settings(mf_data_dir=tmp_path, mf_duckdb_path=tmp_path / "processed" / "test.duckdb")
    s.ensure_dirs()
    return s


@pytest.fixture
def con(settings: Settings) -> duckdb.DuckDBPyConnection:
    connection = duckdb.connect(str(settings.mf_duckdb_path))
    init_schema(connection)
    register_nav_view(connection, settings)
    return connection


def load(
    con: duckdb.DuckDBPyConnection,
    settings: Settings,
    rows: list[tuple[str, str, float]],
    *,
    priority: int = 0,
    replace_all: bool = True,
) -> int:
    frame = pd.DataFrame(rows, columns=["scheme_code", "date", "nav"])
    con.register("src", frame)
    try:
        return write_nav_dataset(
            con,
            f"SELECT scheme_code, date, nav, {priority} AS priority FROM src",
            settings,
            replace_all=replace_all,
        )
    finally:
        con.unregister("src")


def years_on_disk(settings: Settings) -> set[str]:
    return {p.name for p in nav_dataset_dir(settings).glob("year=*")}


def test_rows_land_in_year_partitions(con: duckdb.DuckDBPyConnection, settings: Settings) -> None:
    load(con, settings, [("A", "2020-03-31", 10.0), ("A", "2021-03-31", 12.0)])

    assert years_on_disk(settings) == {"year=2020", "year=2021"}
    assert con.execute("SELECT count(*) FROM nav_daily").fetchone() == (2,)


def test_a_full_write_drops_partitions_the_new_source_no_longer_has(
    con: duckdb.DuckDBPyConnection, settings: Settings
) -> None:
    load(con, settings, [("A", "2020-03-31", 10.0), ("A", "2021-03-31", 12.0)])
    load(con, settings, [("A", "2022-03-31", 14.0)])

    assert years_on_disk(settings) == {"year=2022"}


def test_an_incremental_write_leaves_untouched_years_exactly_as_they_were(
    con: duckdb.DuckDBPyConnection, settings: Settings
) -> None:
    load(con, settings, [("A", "2020-03-31", 10.0), ("A", "2021-03-31", 12.0)])
    untouched = next(nav_dataset_dir(settings).glob("year=2020/*.parquet"))
    before = (untouched.stat().st_mtime_ns, untouched.read_bytes())

    load(con, settings, [("A", "2021-06-30", 13.0)], replace_all=False)

    after = next(nav_dataset_dir(settings).glob("year=2020/*.parquet"))
    assert (after.stat().st_mtime_ns, after.read_bytes()) == before
    assert years_on_disk(settings) == {"year=2020", "year=2021"}
    # 2021 was rewritten from the incremental relation alone, which is why the caller
    # unions the existing partition back in; here that union is deliberately absent.
    assert con.execute("SELECT date FROM nav_daily WHERE year(date) = 2021").fetchall() == [
        (pd.Timestamp("2021-06-30").date(),)
    ]


def test_a_fresher_row_wins_over_the_one_already_stored(
    con: duckdb.DuckDBPyConnection, settings: Settings
) -> None:
    """The tie-break that makes a top-up correct: same scheme and date, newer value."""
    frame = pd.DataFrame(
        [("A", "2020-03-31", 10.0, 0), ("A", "2020-03-31", 11.5, 1)],
        columns=["scheme_code", "date", "nav", "priority"],
    )
    con.register("src", frame)
    write_nav_dataset(con, "SELECT scheme_code, date, nav, priority FROM src", settings)
    con.unregister("src")

    assert con.execute("SELECT nav FROM nav_daily").fetchall() == [(11.5,)]


def test_terminal_zero_navs_are_dropped(con: duckdb.DuckDBPyConnection, settings: Settings) -> None:
    """A matured scheme's final 0.00 is AMFI's end marker, not a price of zero."""
    rows = load(con, settings, [("A", "2020-03-31", 10.0), ("A", "2020-04-30", 0.0)])

    assert rows == 1


def test_a_dropped_zero_nav_is_still_recorded_against_its_scheme(
    con: duckdb.DuckDBPyConnection, settings: Settings
) -> None:
    """The row leaves the lake, so this table is the only trace the exclusion happened."""
    load(
        con,
        settings,
        [("A", "2020-03-31", 10.0), ("A", "2020-04-30", 0.0), ("B", "2020-03-31", 5.0)],
    )

    assert con.execute(
        "SELECT scheme_code, excluded_rows, last_zero_date FROM nav_zero_excluded"
    ).fetchall() == [("A", 1, date(2020, 4, 30))]


def test_a_top_up_adds_newly_zeroed_schemes_without_erasing_the_earlier_census(
    con: duckdb.DuckDBPyConnection, settings: Settings
) -> None:
    load(con, settings, [("A", "2020-03-31", 10.0), ("A", "2020-04-30", 0.0)])
    load(con, settings, [("B", "2021-03-31", 5.0), ("B", "2021-04-30", 0.0)], replace_all=False)

    assert con.execute("SELECT scheme_code FROM nav_zero_excluded ORDER BY 1").fetchall() == [
        ("A",),
        ("B",),
    ]


def test_unparseable_dates_are_dropped_rather_than_failing_the_load(
    con: duckdb.DuckDBPyConnection, settings: Settings
) -> None:
    rows = load(con, settings, [("A", "2020-03-31", 10.0), ("A", "not-a-date", 11.0)])

    assert rows == 1


def test_an_empty_source_never_destroys_the_existing_lake(
    con: duckdb.DuckDBPyConnection, settings: Settings
) -> None:
    load(con, settings, [("A", "2020-03-31", 10.0)])

    with pytest.raises(RuntimeError, match="Refusing to promote an empty NAV write"):
        load(con, settings, [])

    assert years_on_disk(settings) == {"year=2020"}
    assert con.execute("SELECT count(*) FROM nav_daily").fetchone() == (1,)


def write_parquet(path: Path, columns: dict[str, list[object]]) -> Path:
    pq.write_table(pa.table(columns), path)
    return path


def test_validate_nav_file_rejects_a_file_missing_a_required_column(
    tmp_path: Path, settings: Settings
) -> None:
    path = write_parquet(tmp_path / "nav.parquet", {"scheme_code": ["A"], "date": ["2020-01-01"]})

    with pytest.raises(SchemaMismatchError, match="nav"):
        TigZigSource(settings).validate_nav_file(path)


def test_validate_nav_file_reports_columns_the_mapping_does_not_know(
    tmp_path: Path, settings: Settings
) -> None:
    path = write_parquet(
        tmp_path / "nav.parquet",
        {"scheme_code": ["A"], "date": ["2020-01-01"], "nav": [10.0], "aum_cr": [1.0]},
    )

    info = TigZigSource(settings).validate_nav_file(path)

    assert info["unmapped_columns"] == ["aum_cr"]
    assert info["num_rows"] == 1


def test_a_redenominated_scheme_starts_its_comparable_history_at_the_break(
    con: duckdb.DuckDBPyConnection, settings: Settings
) -> None:
    """End to end: a 10x NAV refiling must not compound into the scheme's returns."""
    dates = pd.date_range("2021-01-31", periods=24, freq="ME")
    navs = [100.0 * 1.005**i for i in range(12)]
    navs += [n * 10.0 for n in (100.0 * 1.005**i for i in range(12, 24))]
    load(
        con, settings, [("A", d.strftime("%Y-%m-%d"), v) for d, v in zip(dates, navs, strict=True)]
    )
    refresh_monthly_tables(con)

    series = load_series(con, settings.mf_nav_jump_ratio)["A"]

    assert series.scale_break_at == pd.Timestamp("2022-01-31")
    assert series.monthly.index[0] == pd.Timestamp("2022-01-31")
    # Only the post-break months survive, and none of them carries the artificial jump.
    assert series.returns.dropna().max() < 0.01


def test_sql_drawdown_matches_the_pandas_definition(tmp_path) -> None:
    """Two implementations of one metric, held to the same answer.

    `risk.max_drawdown` is the readable definition; `DRAWDOWN_SQL` is the one that
    actually runs, because 37M daily rows will not fit in pandas. This is what stops
    them drifting apart.
    """
    import numpy as np
    import pandas as pd

    from mf_analytics.config import Settings
    from mf_analytics.db import connect, init_schema
    from mf_analytics.metrics.risk import max_drawdown
    from mf_analytics.pipeline import SchemeSeries, daily_drawdowns

    s = Settings(mf_data_dir=tmp_path / "d", mf_duckdb_path=tmp_path / "d" / "t.duckdb")
    s.ensure_dirs()
    rng = np.random.default_rng(11)
    dates = pd.bdate_range("2020-01-01", "2026-08-31")
    nav = 100.0 * np.cumprod(1.0 + rng.normal(0.0004, 0.011, len(dates)))
    frame = pd.DataFrame({"scheme_code": "A", "date": dates.date, "nav": nav})

    with connect(s) as con:
        init_schema(con)
        con.register("n", frame)
        con.execute("CREATE OR REPLACE TABLE nav_daily AS SELECT * FROM n")
        con.unregister("n")
        monthly = pd.Series(nav, index=dates).resample("ME").last().dropna()
        series = {
            "A": SchemeSeries(
                monthly=pd.DataFrame({"nav": monthly, "obs_date": monthly.index}),
                returns=monthly.pct_change().dropna(),
            )
        }
        as_of = pd.Timestamp("2026-08-31")
        out = daily_drawdowns(con, series, as_of)

    for horizon in (3, 5):
        window = pd.Series(nav, index=dates)
        window = window[
            (window.index > as_of - pd.DateOffset(years=horizon)) & (window.index <= as_of)
        ]
        expected = max_drawdown(window)
        got = out[horizon]["A"]
        assert got.metric.value == pytest.approx(expected.metric.value)
        assert got.peak_date == expected.peak_date
        assert got.trough_date == expected.trough_date


def test_a_daily_drawdown_starts_at_a_nav_redenomination(tmp_path) -> None:
    """Without the cut, a 10x face-value change reads as a 90% crash."""
    import numpy as np
    import pandas as pd

    from mf_analytics.config import Settings
    from mf_analytics.db import connect, init_schema
    from mf_analytics.pipeline import SchemeSeries, daily_drawdowns

    s = Settings(mf_data_dir=tmp_path / "d", mf_duckdb_path=tmp_path / "d" / "t.duckdb")
    s.ensure_dirs()
    dates = pd.bdate_range("2022-01-03", "2026-08-31")
    break_at = pd.Timestamp("2023-06-30")
    # A steady climb, divided by ten on the break date and climbing steadily again.
    nav = np.where(dates < break_at, 1000.0, 100.0) * np.linspace(1.0, 1.4, len(dates))
    frame = pd.DataFrame({"scheme_code": "A", "date": dates.date, "nav": nav})

    with connect(s) as con:
        init_schema(con)
        con.register("n", frame)
        con.execute("CREATE OR REPLACE TABLE nav_daily AS SELECT * FROM n")
        con.unregister("n")
        monthly = pd.Series(nav, index=dates).resample("ME").last().dropna()
        monthly = monthly[monthly.index >= break_at]
        series = {
            "A": SchemeSeries(
                monthly=pd.DataFrame({"nav": monthly, "obs_date": monthly.index}),
                returns=monthly.pct_change().dropna(),
                scale_break_at=break_at,
            )
        }
        out = daily_drawdowns(con, series, pd.Timestamp("2026-08-31"))

    # After the break the series only rises, so there is no drawdown at all.
    assert out[3]["A"].metric.value == pytest.approx(0.0)
