"""Shared source-adapter errors."""

from __future__ import annotations


class SchemaMismatchError(RuntimeError):
    """A source file does not carry the columns the canonical mapping was built against.

    Raised rather than worked around: a renamed or dropped upstream column silently
    mapped to null would surface as missing metrics weeks later.
    """
