"""Structured (key=value) logging shared by scripts and the API."""

from __future__ import annotations

import logging
import os
import sys
from typing import Any


class KeyValueFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        base = (
            f"ts={self.formatTime(record, '%Y-%m-%dT%H:%M:%S')} "
            f"level={record.levelname} logger={record.name} msg={record.getMessage()!r}"
        )
        extra = getattr(record, "context", None)
        if extra:
            base += " " + " ".join(f"{k}={v!r}" for k, v in extra.items())
        if record.exc_info:
            base += "\n" + self.formatException(record.exc_info)
        return base


def configure_logging(level: str | None = None) -> None:
    handler = logging.StreamHandler(sys.stderr)
    handler.setFormatter(KeyValueFormatter())
    root = logging.getLogger()
    root.handlers[:] = [handler]
    root.setLevel(level or os.getenv("MF_LOG_LEVEL") or "INFO")


def get_logger(name: str) -> logging.Logger:
    return logging.getLogger(name)


def log_event(logger: logging.Logger, msg: str, **context: Any) -> None:
    logger.info(msg, extra={"context": context})
