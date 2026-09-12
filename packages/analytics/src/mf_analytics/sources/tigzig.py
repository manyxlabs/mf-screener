"""TigZig AMFI NAV API adapter.

Column names and semantics come from the live catalog (`/mf/v1/` -> schema block),
not from guesswork; `inspect_schema` prints the source columns and this mapping.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, cast

import pandas as pd
import pyarrow.parquet as pq

from ..config import Settings, get_settings
from ..http_client import download_file, head_signature, request_json
from ..logging_setup import get_logger, log_event
from .base import SchemaMismatchError

logger = get_logger(__name__)

# source column -> canonical column
MASTER_COLUMN_MAP: dict[str, str] = {
    "scheme_code": "scheme_code",
    "scheme_name": "scheme_name",
    "amc": "amc",
    "isin": "isin_growth",
    "isin2": "isin_dividend",
    "scheme_type": "scheme_type",
    "category": "category",
    "category_sub": "category_sub",
    "category_group_clean": "category_group_clean",
    "category_group": "category_group_raw",
    "scheme_plan": "scheme_plan",
    "scheme_option": "scheme_option",
    "first_date": "first_nav_date",
    "last_date": "last_nav_date",
    "is_active": "is_active",
    "is_stale": "is_stale",
    "txic_code": "txic_code",
    "aaum_cr_quarterly_avg": "latest_aum",
    "aaum_quarter": "aum_quarter",
    "aaum_quarter_end": "aum_date",
    "nav_date": "latest_nav_date",
    "nav": "latest_nav",
}

NAV_COLUMN_MAP: dict[str, str] = {
    "scheme_code": "scheme_code",
    "date": "date",
    "nav": "nav",
    "scheme_name": "scheme_name",
    "isin": "isin",
}

# Only these three are read by the pipeline; the rest are carried for provenance.
# `date` arrives as a string and `nav` as a decimal, per the provider's field guide.
NAV_REQUIRED_COLUMNS = ("scheme_code", "date", "nav")


def inspect_parquet(path: Path) -> dict[str, Any]:
    """Columns, types and row counts read from the parquet footer - no data is loaded."""
    meta = pq.ParquetFile(path)
    return {
        "path": str(path),
        "file_bytes": path.stat().st_size,
        "num_rows": meta.metadata.num_rows,
        "num_row_groups": meta.num_row_groups,
        "created_by": meta.metadata.created_by,
        "columns": {f.name: str(f.type) for f in meta.schema_arrow},
    }


def sample_rows(path: Path, n: int = 5) -> list[dict[str, Any]]:
    """The first `n` rows of a parquet file, read one batch at a time.

    Used on the 177 MB NAV history as well as the master, so it must never read past
    the first batch: example rows are for eyeballing the source, not for analysis.
    """
    batches = pq.ParquetFile(path).iter_batches(batch_size=n)
    first = next(batches, None)
    return [] if first is None else cast(list[dict[str, Any]], first.to_pylist()[:n])


class TigZigSource:
    name = "tigzig"

    def __init__(self, settings: Settings | None = None) -> None:
        self.settings = settings or get_settings()

    def _url(self, path: str) -> str:
        return f"{self.settings.mf_api_base.rstrip('/')}/{path.lstrip('/')}"

    def master_url(self) -> str:
        return self._url("download")

    def nav_url(self) -> str:
        return self._url("download")

    def catalog(self) -> dict[str, Any]:
        return request_json(self._url(""), settings=self.settings)

    def openapi(self) -> dict[str, Any]:
        return request_json(
            f"{self.settings.mf_api_base.rstrip('/')}/openapi.json", settings=self.settings
        )

    def manifest(self) -> dict[str, Any]:
        return request_json(self._url("downloads/manifest"), settings=self.settings)

    def _fetch(self, dest: Path, fmt: str, force: bool) -> dict[str, Any]:
        url, params = self.master_url(), {"format": fmt}
        sig_path = dest.with_suffix(dest.suffix + ".signature.json")
        signature = head_signature(url, params, self.settings)
        if not force and dest.exists() and sig_path.exists() and signature:
            previous = json.loads(sig_path.read_text())
            if previous.get("signature") == signature:
                log_event(logger, "download.skipped_unchanged", url=url, format=fmt, path=str(dest))
                return {**previous, "skipped": True}
        meta = download_file(url, dest, params=params, settings=self.settings, signature=signature)
        meta.update({"format": fmt, "signature": signature, "source": self.name, "skipped": False})
        sig_path.write_text(json.dumps(meta, indent=2, default=str))
        return meta

    def manifest_file(self, fmt: str) -> dict[str, Any]:
        """The manifest entry for a download format: advertised size and row count."""
        files = self.manifest().get("files", {})
        for info in files.values():
            if info.get("format") == fmt:
                return info
        raise ValueError(f"Provider offers no {fmt!r} download; available: {sorted(files)}")

    def validate_nav_file(self, path: Path) -> dict[str, Any]:
        """Check a downloaded NAV file against the mapping before anything reads it."""
        info = inspect_parquet(path)
        present = set(info["columns"])
        missing = sorted(set(NAV_REQUIRED_COLUMNS) - present)
        if missing:
            raise SchemaMismatchError(
                f"{path.name} is missing required columns {missing}. "
                f"Source columns are {sorted(present)}. "
                "Run `make inspect` and update NAV_COLUMN_MAP before ingesting."
            )
        info["unmapped_columns"] = sorted(present - set(NAV_COLUMN_MAP))
        info["dropped_columns"] = sorted(set(NAV_COLUMN_MAP) - present)
        if info["unmapped_columns"] or info["dropped_columns"]:
            log_event(
                logger,
                "nav.schema_drift",
                new=info["unmapped_columns"],
                gone=info["dropped_columns"],
            )
        return info

    def fetch_master(self, dest: Path, force: bool = False) -> dict[str, Any]:
        return self._fetch(dest, self.settings.mf_master_format, force)

    def fetch_nav(self, dest: Path, force: bool = False) -> dict[str, Any]:
        return self._fetch(dest, self.settings.mf_nav_format, force)

    @staticmethod
    def _read_any(path: Path) -> pd.DataFrame:
        name = path.name.lower()
        if name.endswith(".parquet"):
            return pd.read_parquet(path)
        if name.endswith((".csv", ".csv.gz", ".csv.zip")):
            return pd.read_csv(path, low_memory=False)
        if name.endswith((".tsv", ".tsv.gz", ".tsv.zip")):
            return pd.read_csv(path, sep="\t", low_memory=False)
        raise ValueError(f"Unsupported source file format: {path.name}")

    def read_master(self, path: Path) -> pd.DataFrame:
        return self._read_any(path)

    def read_nav(self, path: Path) -> pd.DataFrame:
        return self._read_any(path)

    def fetch_scheme_nav(self, scheme_code: str) -> pd.DataFrame:
        payload = request_json(self._url("nav"), {"scheme": scheme_code}, self.settings)
        rows = payload.get("data", [])
        df = pd.DataFrame(rows, columns=["date", "nav"])
        df["scheme_code"] = str(scheme_code)
        return df

    def fetch_many_nav(self, scheme_codes: list[str], since: str | None = None) -> pd.DataFrame:
        """Bulk NAV history; the API accepts at most 50 identifiers per call."""
        frames: list[pd.DataFrame] = []
        for i in range(0, len(scheme_codes), 50):
            batch = scheme_codes[i : i + 50]
            params: dict[str, Any] = {"schemes": ",".join(batch)}
            if since:
                params["since"] = since
            payload = request_json(self._url("nav"), params, self.settings)
            for scheme in payload.get("schemes", []):
                rows = scheme.get("data", [])
                if not rows:
                    continue
                df = pd.DataFrame(rows)
                df["scheme_code"] = str(scheme["scheme_code"])
                df["scheme_name"] = scheme.get("scheme_name")
                df["isin"] = scheme.get("isin")
                frames.append(df)
            missing = payload.get("not_found", [])
            if missing:
                log_event(logger, "nav.not_found", identifiers=missing)
            log_event(logger, "nav.batch_done", batch=i // 50 + 1, size=len(batch))
        if not frames:
            return pd.DataFrame(columns=list(NAV_COLUMN_MAP))
        return pd.concat(frames, ignore_index=True)

    def search(self, **filters: Any) -> pd.DataFrame:
        payload = request_json(self._url("search"), filters, self.settings)
        return pd.DataFrame(payload.get("results", payload.get("data", [])))
