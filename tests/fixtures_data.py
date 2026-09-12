"""Builds a self-contained synthetic data lake so integration tests never touch the network."""

from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path

import numpy as np
import pandas as pd

from mf_analytics.classify import cap_band, derive_fund_family_ids, style
from mf_analytics.config import Settings
from mf_analytics.db import connect, init_schema
from mf_analytics.ingest.master import CANONICAL_COLUMNS, load_master
from mf_analytics.ingest.nav import refresh_monthly_tables, write_nav_dataset

START = "2010-01-31"
MONTHS = 190

SCHEMES = [
    # code, name, amc, sub-category, plan, option, active, monthly drift, monthly vol
    (
        "S01",
        "Alpha Mid Cap Fund - Direct - Growth",
        "Alpha AMC",
        "Mid Cap Fund",
        "Direct",
        "Growth",
        True,
        0.0135,
        0.045,
    ),
    (
        "S02",
        "Beta Mid Cap Fund - Direct - Growth",
        "Beta AMC",
        "Mid Cap Fund",
        "Direct",
        "Growth",
        True,
        0.0120,
        0.048,
    ),
    (
        "S03",
        "Gamma Mid Cap Fund - Direct - Growth",
        "Gamma AMC",
        "Mid Cap Fund",
        "Direct",
        "Growth",
        True,
        0.0105,
        0.043,
    ),
    (
        "S04",
        "Delta Mid Cap Fund - Direct - Growth",
        "Delta AMC",
        "Mid Cap Fund",
        "Direct",
        "Growth",
        True,
        0.0095,
        0.050,
    ),
    (
        "S05",
        "Epsilon Mid Cap Fund - Direct - Growth",
        "Epsilon AMC",
        "Mid Cap Fund",
        "Direct",
        "Growth",
        True,
        0.0085,
        0.041,
    ),
    (
        "S06",
        "Zeta Mid Cap Fund - Direct - Growth",
        "Zeta AMC",
        "Mid Cap Fund",
        "Direct",
        "Growth",
        True,
        0.0075,
        0.052,
    ),
    (
        "S07",
        "Alpha Mid Cap Fund - Regular - Growth",
        "Alpha AMC",
        "Mid Cap Fund",
        "Regular",
        "Growth",
        True,
        0.0125,
        0.045,
    ),
    (
        "S08",
        "Alpha Mid Cap Fund - Direct - IDCW",
        "Alpha AMC",
        "Mid Cap Fund",
        "Direct",
        "IDCW",
        True,
        0.0090,
        0.045,
    ),
    (
        "S09",
        "Eta Small Cap Fund - Direct - Growth",
        "Eta AMC",
        "Small Cap Fund",
        "Direct",
        "Growth",
        True,
        0.0140,
        0.060,
    ),
    (
        "S10",
        "Theta Small Cap Fund - Direct - Growth",
        "Theta AMC",
        "Small Cap Fund",
        "Direct",
        "Growth",
        True,
        0.0110,
        0.058,
    ),
    (
        "S11",
        "Iota Small Cap Fund - Direct - Growth",
        "Iota AMC",
        "Small Cap Fund",
        "Direct",
        "Growth",
        True,
        0.0100,
        0.062,
    ),
    (
        "S12",
        "Kappa Small Cap Fund - Direct - Growth",
        "Kappa AMC",
        "Small Cap Fund",
        "Direct",
        "Growth",
        False,
        0.0080,
        0.055,
    ),
    (
        "S13",
        "Lambda Value Fund - Direct - Growth",
        "Lambda AMC",
        "Value Fund",
        "Direct",
        "Growth",
        True,
        0.0090,
        0.040,
    ),
    (
        "S14",
        "Mu Nifty Index Fund - Direct - Growth",
        "Mu AMC",
        "Index Funds",
        "Direct",
        "Growth",
        True,
        0.0100,
        0.040,
    ),
    # The only fund in its sub-category, so every peer-relative column of its is null for
    # want of peers. That is what SEBI's four-fund Contra category looks like in real data.
    (
        "S15",
        "Nu Contra Fund - Direct - Growth",
        "Nu AMC",
        "Contra Fund",
        "Direct",
        "Growth",
        True,
        0.0125,
        0.042,
    ),
]


def _nav_series(drift: float, vol: float, seed: int, months: int = MONTHS) -> pd.DataFrame:
    rng = np.random.default_rng(seed)
    dates = pd.date_range(START, periods=months, freq="ME")
    shocks = rng.normal(drift, vol, months)
    shocks[0] = 0.0
    nav = 100.0 * np.cumprod(1.0 + shocks)
    return pd.DataFrame({"date": dates, "nav": nav})


def build(settings: Settings) -> None:
    settings.ensure_dirs()
    now = datetime.now(UTC).replace(tzinfo=None)
    master_rows = []
    nav_frames = []
    for i, (code, name, amc, sub, plan, option, active, drift, vol) in enumerate(SCHEMES):
        months = MONTHS if code != "S12" else 120
        nav = _nav_series(drift, vol, seed=1000 + i, months=months)
        nav["scheme_code"] = code
        nav_frames.append(nav)
        master_rows.append(
            {
                "scheme_code": code,
                "scheme_name": name,
                "amc": amc,
                "scheme_type": "Open Ended Schemes",
                "category": "Equity",
                "sub_category": sub,
                "clean_category": "Equity Scheme",
                "clean_sub_category": sub,
                # Derived by the production classifier, so the fixture cannot drift from it.
                "cap_band": cap_band(sub, name),
                "style": style("Equity Scheme", sub, name),
                "plan": plan,
                "option": option,
                "clean_plan": plan,
                "clean_option": "Growth" if option == "Growth" else "IDCW Payout",
                "isin_growth": f"INF000{code}",
                "isin_dividend": None,
                "launch_date": nav["date"].iloc[0].date(),
                "first_nav_date": nav["date"].iloc[0].date(),
                "last_nav_date": nav["date"].iloc[-1].date(),
                "latest_nav": float(nav["nav"].iloc[-1]),
                "latest_nav_date": nav["date"].iloc[-1].date(),
                "latest_aum": 1000.0 + 100 * i,
                "aum_date": nav["date"].iloc[-1].date(),
                "aum_quarter": "June-2026",
                "is_active": active,
                "is_stale": False,
                "fund_age_years": round(
                    (nav["date"].iloc[-1] - nav["date"].iloc[0]).days / 365.25, 4
                ),
                "source": "synthetic",
                "ingested_at": now,
            }
        )
    master = pd.DataFrame(master_rows)
    # Derived by the production grouper for the same reason cap_band and style are:
    # the three Alpha Mid Cap rows (S01 Direct Growth, S07 Regular, S08 IDCW) have to
    # collapse into one family here exactly as they would in real data.
    master["fund_family_id"] = derive_fund_family_ids(master)
    master = master.loc[:, CANONICAL_COLUMNS]
    master["is_active"] = master["is_active"].astype("boolean")
    master["is_stale"] = master["is_stale"].astype("boolean")
    load_master(master, settings)

    nav = pd.concat(nav_frames, ignore_index=True)
    with connect(settings) as con:
        init_schema(con)
        con.register("nav_synth", nav.loc[:, ["scheme_code", "date", "nav"]])
        write_nav_dataset(
            con, "SELECT scheme_code, date, nav, 0 AS priority FROM nav_synth", settings
        )
        con.unregister("nav_synth")
        refresh_monthly_tables(con, settings.mf_month_end_tolerance_days)

        bench = _nav_series(0.0100, 0.038, seed=99)
        bench_rows = pd.DataFrame(
            {
                "benchmark_id": "NIFTY_MIDCAP150_TRI",
                "benchmark_name": "Synthetic Midcap TRI",
                "asset_class": "Equity",
                "currency": "INR",
                "source": "synthetic",
                "date": bench["date"].dt.date,
                "price_or_total_return_index": bench["nav"],
                "monthly_return": bench["nav"].pct_change(),
            }
        )
        con.register("bm", bench_rows)
        con.execute(
            "INSERT INTO benchmarks SELECT benchmark_id, benchmark_name, asset_class, currency, "
            "source, date, price_or_total_return_index, monthly_return FROM bm"
        )
        con.unregister("bm")
        mapped = pd.DataFrame(
            [
                {
                    "scheme_code": c[0],
                    "benchmark_id": "NIFTY_MIDCAP150_TRI",
                    "source_type": "test",
                    "confidence": "high",
                    "effective_from": None,
                    "effective_to": None,
                    "notes": None,
                }
                for c in SCHEMES
                if c[3] == "Mid Cap Fund"
            ]
        )
        mapped["effective_from"] = pd.to_datetime(mapped["effective_from"]).dt.date
        mapped["effective_to"] = pd.to_datetime(mapped["effective_to"]).dt.date
        con.register("bmap", mapped)
        con.execute(
            "INSERT INTO scheme_benchmark_map SELECT scheme_code, benchmark_id, source_type, "
            "confidence, effective_from, effective_to, notes FROM bmap"
        )
        con.unregister("bmap")

        # Only S01 is priced, so the tests can see both a real expense ratio and the
        # named blank that every unpriced scheme has to carry.
        con.execute(
            "INSERT INTO scheme_ter VALUES ('S01', 0.0062, 0.0052, 'Direct', "
            "'Alpha Midcap Fund', 'alpha midcap fund', 'synthetic', now()::TIMESTAMP)"
        )


def make_settings(tmp_path: Path) -> Settings:
    return Settings(
        mf_data_dir=tmp_path / "data",
        mf_duckdb_path=tmp_path / "data" / "processed" / "test.duckdb",
    )
