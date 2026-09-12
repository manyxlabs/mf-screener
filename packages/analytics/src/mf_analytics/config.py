"""Runtime settings. Every external endpoint and analytics constant lives here."""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Final

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

REPO_ROOT = Path(__file__).resolve().parents[4]

# AMFI publishes every NAV in rupees. A benchmark in any other currency measures a
# different thing, and this project does no FX conversion, so a mapping to one is
# reported and its benchmark-relative metrics withheld rather than computed.
BASE_CURRENCY: Final = "INR"

HORIZONS: Final = (3, 5, 10)
TRAILING_HORIZONS: Final = (1, 3, 5, 10)
# Rolling windows go down to one year because a 1-year window still yields a long series of
# overlapping observations. The comparative and risk metrics stay on HORIZONS: 10 monthly
# observations is too thin a sample for a beta or a Sharpe worth sorting a screener on.
ROLLING_HORIZONS: Final = (1, 3, 5, 10)


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(REPO_ROOT / ".env"), env_file_encoding="utf-8", extra="ignore"
    )

    mf_api_base: str = "https://api.tigzig.com/mf/v1"
    mf_master_format: str = "latest.parquet"
    mf_nav_format: str = "parquet"
    mf_http_timeout: float = 180.0
    mf_http_retries: int = 5
    mf_http_backoff: float = 2.0
    mf_user_agent: str = "mf-screener/0.1 (local research tool)"

    # AMFI requires every AMC to publish TER daily, but only per AMC behind a form, so
    # there is no consolidated feed to read. This is a daily scrape of those pages. It
    # is partial - see `mf ter-import`, which reports exactly what it covered.
    mf_ter_csv_url: str = (
        "https://raw.githubusercontent.com/captn3m0/india-mutual-fund-ter-tracker/main/data.csv"
    )

    # Bulk ingestion streams through DuckDB and spills to disk past this ceiling,
    # so the 37M-row history loads on a laptop rather than needing the RAM to hold it.
    mf_duckdb_memory_limit: str = "3GB"
    mf_duckdb_threads: int = 0

    mf_data_dir: Path = REPO_ROOT / "data"
    mf_duckdb_path: Path = REPO_ROOT / "data" / "processed" / "mf.duckdb"

    # Capital gains tax on mutual fund redemption, current as of the 2024-25 regime.
    # Equity-oriented (equity, or a hybrid whose SEBI mandate fixes equity at 65%+):
    # long-term gains above the exemption at the long-term rate past MF_LT_HOLDING_MONTHS,
    # short-term rate below it. Debt-oriented: the holder's slab rate regardless of
    # holding period, for units acquired on or after 1 April 2023.
    mf_ltcg_rate: float = 0.125
    mf_ltcg_exemption: float = 125000.0
    mf_stcg_rate: float = 0.20
    mf_lt_holding_months: int = 12
    mf_slab_rate: float = 0.30

    mf_risk_free_annual: float = 0.065
    mf_month_end_tolerance_days: int = 10
    mf_min_rolling_windows: int = 12
    mf_min_peers: int = 5
    # A month whose NAV multiplies or divides by more than this is a unit-basis change,
    # not a market move: no Indian mutual fund has ever doubled or halved in a month.
    mf_nav_jump_ratio: float = 2.0
    mf_methodology_version: str = "1.0.0"

    # Enrichment sources (T3.1) are third party and unauthoritative, so they get their
    # own, tighter timeout/retry budget rather than borrowing the NAV provider's: a
    # flaky enrichment source must not slow down or fail a NAV ingest.
    mf_enrich_http_timeout: float = 30.0
    mf_enrich_http_retries: int = 3
    mf_enrich_http_backoff: float = 2.0
    # Past this many days since an enrichment row's `as_of`, the UI labels it stale
    # rather than presenting it as current. Riskometer is a monthly SEBI disclosure,
    # so a month plus a grace window is the generic default; a field with its own
    # cadence can compare its `as_of` against a tighter threshold if it needs one.
    mf_enrich_stale_days: int = 45
    # T3.2: base URL of the scheme-attributes enrichment source. Unreachable on first
    # contact (HTTP 522) - see docs/data-policy.md - so this is the assumed shape,
    # overridable once the source is confirmed to answer.
    mf_attributes_source_url: str = "https://mfdata.in/api/v1"

    mf_api_host: str = "127.0.0.1"
    mf_api_port: int = 8000
    mf_cors_origins: str = "http://localhost:3000"

    benchmark_map_path: Path = Field(
        default=REPO_ROOT / "packages" / "analytics" / "benchmark_map.yaml"
    )

    @field_validator("mf_data_dir", "mf_duckdb_path", "benchmark_map_path", mode="after")
    @classmethod
    def _anchor_to_repo(cls, value: Path) -> Path:
        """Relative paths in .env mean "relative to the repo", not to the caller's cwd."""
        return value if value.is_absolute() else (REPO_ROOT / value).resolve()

    @property
    def raw_dir(self) -> Path:
        return self.mf_data_dir / "raw"

    @property
    def processed_dir(self) -> Path:
        return self.mf_data_dir / "processed"

    @property
    def cache_dir(self) -> Path:
        return self.mf_data_dir / "cache"

    @property
    def exports_dir(self) -> Path:
        return self.mf_data_dir / "exports"

    @property
    def risk_free_monthly(self) -> float:
        """Geometric conversion; a naive /12 would overstate the monthly hurdle."""
        return (1.0 + self.mf_risk_free_annual) ** (1.0 / 12.0) - 1.0

    def ensure_dirs(self) -> None:
        for d in (self.raw_dir, self.processed_dir, self.cache_dir, self.exports_dir):
            d.mkdir(parents=True, exist_ok=True)


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
