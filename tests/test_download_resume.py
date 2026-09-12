"""Resumable-download behaviour, exercised against a local HTTP server.

No test here touches the internet: a stdlib server on 127.0.0.1 stands in for the
provider, which is what makes it possible to simulate a transfer dying mid-file.
"""

from __future__ import annotations

import hashlib
import json
import threading
from collections.abc import Iterator
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import pytest

from mf_analytics.config import Settings
from mf_analytics.http_client import DownloadError, download_file, sha256_file

# Comfortably larger than the downloader's 1 MB read chunk, so an interrupted transfer
# leaves real bytes on disk to resume from rather than an empty buffer.
PAYLOAD = bytes(range(256)) * 24_000  # 6.1 MB
CUTOFF = 3_500_000


class _Handler(BaseHTTPRequestHandler):
    """Serves PAYLOAD with Range support; truncates the first GET to force a resume."""

    truncate_next = False
    etag = '"v1"'

    def log_message(self, *args: object) -> None:
        pass

    def _range(self) -> int:
        header = self.headers.get("Range")
        return int(header.removeprefix("bytes=").split("-")[0]) if header else 0

    def do_HEAD(self) -> None:
        self.send_response(200)
        self.send_header("Content-Length", str(len(PAYLOAD)))
        self.send_header("ETag", type(self).etag)
        self.send_header("Accept-Ranges", "bytes")
        self.end_headers()

    def do_GET(self) -> None:
        start = self._range()
        body = PAYLOAD[start:]
        self.send_response(206 if start else 200)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("ETag", type(self).etag)
        if start:
            self.send_header("Content-Range", f"bytes {start}-{len(PAYLOAD) - 1}/{len(PAYLOAD)}")
        self.end_headers()
        if type(self).truncate_next:
            # Fewer bytes than Content-Length promised: the client sees a broken transfer.
            type(self).truncate_next = False
            self.wfile.write(body[:CUTOFF])
            self.close_connection = True
            return
        self.wfile.write(body)


@pytest.fixture
def server() -> Iterator[str]:
    _Handler.truncate_next = False
    _Handler.etag = '"v1"'
    httpd = ThreadingHTTPServer(("127.0.0.1", 0), _Handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    try:
        yield f"http://127.0.0.1:{httpd.server_address[1]}/file.parquet"
    finally:
        httpd.shutdown()
        httpd.server_close()


@pytest.fixture
def settings(tmp_path: Path) -> Settings:
    return Settings(mf_data_dir=tmp_path, mf_http_retries=3, mf_http_backoff=0.01)


def test_download_matches_the_source_bytes(server: str, tmp_path: Path, settings: Settings) -> None:
    dest = tmp_path / "file.parquet"
    meta = download_file(server, dest, settings=settings, progress=False)

    assert dest.read_bytes() == PAYLOAD
    assert meta["bytes"] == len(PAYLOAD)
    assert meta["sha256"] == hashlib.sha256(PAYLOAD).hexdigest()
    assert meta["resumed_from"] is None


def test_a_truncated_transfer_resumes_instead_of_restarting(
    server: str, tmp_path: Path, settings: Settings
) -> None:
    _Handler.truncate_next = True
    dest = tmp_path / "file.parquet"

    meta = download_file(server, dest, settings=settings, progress=False)

    assert dest.read_bytes() == PAYLOAD
    # The exact offset depends on how much of the truncated body was flushed, but it
    # must be a real resume, and the resulting file must be byte-identical.
    assert 0 < meta["resumed_from"] <= CUTOFF
    assert meta["sha256"] == sha256_file(dest)
    assert not dest.with_suffix(".parquet.part").exists()
    assert not dest.with_suffix(".parquet.part.json").exists()


def test_a_partial_file_from_a_different_revision_is_discarded(
    server: str, tmp_path: Path, settings: Settings
) -> None:
    """A stale partial must never be spliced onto bytes from a newer dataset."""
    dest = tmp_path / "file.parquet"
    part = dest.with_suffix(".parquet.part")
    part.write_bytes(b"\x00" * CUTOFF)
    dest.with_suffix(".parquet.part.json").write_text(
        json.dumps({"url": server, "signature": {"etag": '"stale"'}})
    )

    meta = download_file(server, dest, settings=settings, progress=False)

    assert dest.read_bytes() == PAYLOAD
    assert meta["resumed_from"] is None


def test_a_partial_file_from_the_same_revision_is_reused(
    server: str, tmp_path: Path, settings: Settings
) -> None:
    dest = tmp_path / "file.parquet"
    dest.with_suffix(".parquet.part").write_bytes(PAYLOAD[:CUTOFF])
    dest.with_suffix(".parquet.part.json").write_text(
        json.dumps(
            {
                "url": server,
                "signature": {
                    "etag": '"v1"',
                    "content_length": str(len(PAYLOAD)),
                },
            }
        )
    )

    meta = download_file(server, dest, settings=settings, progress=False)

    assert meta["resumed_from"] == CUTOFF
    assert dest.read_bytes() == PAYLOAD


def test_a_permanently_failing_download_raises_and_keeps_no_output(
    tmp_path: Path, settings: Settings
) -> None:
    dest = tmp_path / "file.parquet"
    with pytest.raises(DownloadError):
        download_file("http://127.0.0.1:1/nothing", dest, settings=settings, progress=False)
    assert not dest.exists()
