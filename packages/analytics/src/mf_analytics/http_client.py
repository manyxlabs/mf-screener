"""HTTP with retry/backoff, rate-limit awareness and streaming downloads."""

from __future__ import annotations

import hashlib
import json
import time
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import httpx

from .config import Settings, get_settings
from .logging_setup import get_logger, log_event

logger = get_logger(__name__)

RETRY_STATUS = {408, 425, 429, 500, 502, 503, 504}


class DownloadError(RuntimeError):
    pass


@contextmanager
def client(settings: Settings | None = None) -> Iterator[httpx.Client]:
    s = settings or get_settings()
    with httpx.Client(
        timeout=httpx.Timeout(s.mf_http_timeout, connect=30.0),
        headers={"User-Agent": s.mf_user_agent, "Accept-Encoding": "gzip"},
        follow_redirects=True,
    ) as c:
        yield c


def _sleep_for(resp: httpx.Response | None, attempt: int, backoff: float) -> float:
    if resp is not None:
        retry_after = resp.headers.get("Retry-After")
        if retry_after and retry_after.isdigit():
            return float(retry_after)
    return backoff * (2**attempt)


def get_with_retry(
    c: httpx.Client, url: str, params: dict[str, Any] | None, settings: Settings
) -> httpx.Response:
    """GET, retrying a timeout, a dropped connection or a transient status with backoff.

    Any other status is returned for the caller to judge: a 400 can be a source's way of
    saying "nothing published here", and retrying it would only wait to hear it again.
    """
    last: Exception | None = None
    for attempt in range(settings.mf_http_retries):
        resp = None
        try:
            resp = c.get(url, params=params)
            if resp.status_code in RETRY_STATUS:
                raise DownloadError(f"HTTP {resp.status_code} for {url}")
            return resp
        except (httpx.TransportError, DownloadError) as exc:
            last = exc
            wait = _sleep_for(resp, attempt, settings.mf_http_backoff)
            log_event(
                logger, "http.retry", url=url, attempt=attempt + 1, wait_s=wait, error=str(exc)
            )
            time.sleep(wait)
    raise DownloadError(f"GET {url} failed after {settings.mf_http_retries} attempts: {last}")


def request_json(
    url: str, params: dict[str, Any] | None = None, settings: Settings | None = None
) -> Any:
    s = settings or get_settings()
    with client(s) as c:
        resp = get_with_retry(c, url, params, s)
    resp.raise_for_status()
    return resp.json()


def sha256_file(path: Path, chunk: int = 1 << 22) -> str:
    """Checksum of a file on disk. Re-read rather than accumulated during the transfer,
    so a download resumed in a later process still gets a checksum over the whole file."""
    digest = hashlib.sha256()
    with path.open("rb") as fh:
        for block in iter(lambda: fh.read(chunk), b""):
            digest.update(block)
    return digest.hexdigest()


def _resume_offset(part: Path, state: Path, signature: dict[str, str]) -> int:
    """Bytes of `part` that may be kept, given what the server is serving right now.

    A partial file is only safe to continue when the remote artefact is provably the
    same one it came from. Without an ETag or Last-Modified to compare, or on any
    mismatch, the partial file is discarded rather than silently spliced onto a
    different revision of the dataset.
    """
    if not (part.exists() and state.exists() and signature):
        part.unlink(missing_ok=True)
        return 0
    try:
        previous = json.loads(state.read_text()).get("signature")
    except (OSError, json.JSONDecodeError):
        previous = None
    if previous != signature:
        log_event(logger, "download.partial_discarded", path=str(part), reason="signature_changed")
        part.unlink(missing_ok=True)
        return 0
    return part.stat().st_size


def _progress(dest: Path, written: int, total: int, started: float) -> None:
    pct = f"{100 * written / total:.1f}%" if total else "?"
    rate = written / max(time.time() - started, 1e-6) / 1e6
    print(
        f"  {dest.name}: {written / 1e6:.1f} MB of {total / 1e6:.1f} MB ({pct}) at {rate:.1f} MB/s",
        flush=True,
    )


def download_file(
    url: str,
    dest: Path,
    params: dict[str, Any] | None = None,
    settings: Settings | None = None,
    progress: bool = True,
    signature: dict[str, str] | None = None,
) -> dict[str, Any]:
    """Stream a URL to disk, resuming a partial transfer where the server allows it.

    The partial file and its provenance survive process exit, so an interrupted
    170 MB download continues from where it stopped on the next run.
    """
    s = settings or get_settings()
    dest.parent.mkdir(parents=True, exist_ok=True)
    part = dest.with_suffix(dest.suffix + ".part")
    state = dest.with_suffix(dest.suffix + ".part.json")
    signature = head_signature(url, params, s) if signature is None else signature
    expected = int(signature.get("content_length") or 0)
    offset = _resume_offset(part, state, signature)
    started = time.time()
    last: Exception | None = None

    with client(s) as c:
        for attempt in range(s.mf_http_retries):
            resp_holder: httpx.Response | None = None
            try:
                # identity: a compressed transfer would make byte offsets meaningless,
                # and every artefact here is already-compressed parquet or gzip.
                headers = {"Accept-Encoding": "identity"}
                if offset:
                    headers["Range"] = f"bytes={offset}-"
                with c.stream("GET", url, params=params, headers=headers) as resp:
                    resp_holder = resp
                    if resp.status_code in RETRY_STATUS:
                        raise DownloadError(f"HTTP {resp.status_code} for {url}")
                    if offset and resp.status_code != 206:
                        # 200 means the range was ignored; 416 means our offset is past
                        # the end of the current artefact. Either way, start clean.
                        log_event(
                            logger, "download.resume_rejected", url=url, status=resp.status_code
                        )
                        offset = 0
                    resp.raise_for_status()
                    total = offset + int(resp.headers.get("Content-Length", 0) or 0)
                    state.write_text(json.dumps({"url": url, "signature": signature}, indent=2))
                    if offset:
                        log_event(logger, "download.resumed", url=url, offset=offset, total=total)
                    with part.open("ab" if offset else "wb") as fh:
                        written = offset
                        next_report = written + (16 << 20)
                        for chunk in resp.iter_bytes(1 << 20):
                            fh.write(chunk)
                            written += len(chunk)
                            if progress and written >= next_report:
                                _progress(dest, written, total, started)
                                next_report = written + (16 << 20)
                    headers_seen = dict(resp.headers)
                if expected and written != expected:
                    raise DownloadError(
                        f"{dest.name}: got {written} bytes, server advertised {expected}"
                    )
                checksum = sha256_file(part)
                part.replace(dest)
                state.unlink(missing_ok=True)
                return {
                    "url": str(resp_holder.url) if resp_holder else url,
                    "bytes": written,
                    "sha256": checksum,
                    "seconds": round(time.time() - started, 2),
                    "resumed_from": offset or None,
                    "downloaded_at": datetime.now(UTC).replace(tzinfo=None).isoformat(),
                    "last_modified": headers_seen.get("last-modified"),
                    "etag": headers_seen.get("etag"),
                }
            except (httpx.HTTPError, DownloadError) as exc:
                last = exc
                # Keep the bytes already on disk: the next attempt continues from them.
                offset = part.stat().st_size if part.exists() else 0
                wait = _sleep_for(resp_holder, attempt, s.mf_http_backoff)
                log_event(
                    logger,
                    "download.retry",
                    url=url,
                    attempt=attempt + 1,
                    wait_s=wait,
                    resume_from=offset,
                    error=str(exc),
                )
                time.sleep(wait)
    raise DownloadError(f"Download {url} failed after {s.mf_http_retries} attempts: {last}")


def head_signature(
    url: str, params: dict[str, Any] | None = None, settings: Settings | None = None
) -> dict[str, str]:
    """Cheap change-detection signature used to make downloads idempotent."""
    s = settings or get_settings()
    try:
        with client(s) as c:
            resp = c.head(url, params=params)
            resp.raise_for_status()
            return {
                k: v
                for k, v in {
                    "etag": resp.headers.get("etag", ""),
                    "last_modified": resp.headers.get("last-modified", ""),
                    "content_length": resp.headers.get("content-length", ""),
                }.items()
                if v
            }
    except httpx.HTTPError as exc:
        log_event(logger, "head.unavailable", url=url, error=str(exc))
        return {}
