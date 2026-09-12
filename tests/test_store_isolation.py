"""The guard that keeps a test from writing into the store the app itself uses."""

from __future__ import annotations

import duckdb
import pytest

from .conftest import PRODUCTION_STORE


@pytest.mark.skipif(PRODUCTION_STORE is None, reason="no MF_DUCKDB_PATH configured in .env")
def test_opening_the_configured_store_from_a_test_is_refused() -> None:
    """Without this, a fixture that forgets to override the path writes its synthetic
    master over the real one, and the guard silently rotting would restore that."""
    with pytest.raises(RuntimeError, match="configured store"):
        duckdb.connect(str(PRODUCTION_STORE))


@pytest.mark.skipif(PRODUCTION_STORE is None, reason="no MF_DUCKDB_PATH configured in .env")
def test_the_same_store_reached_by_a_different_spelling_is_also_refused() -> None:
    """A relative path, or one with a `..` in it, is the same file and must not slip by."""
    sneaky = PRODUCTION_STORE.parent / ".." / PRODUCTION_STORE.parent.name / PRODUCTION_STORE.name
    with pytest.raises(RuntimeError, match="configured store"):
        duckdb.connect(str(sneaky))


def test_a_temporary_store_is_still_allowed(tmp_path) -> None:
    with duckdb.connect(str(tmp_path / "fine.duckdb")) as con:
        assert con.execute("SELECT 1").fetchone() == (1,)


def test_in_memory_is_still_allowed() -> None:
    with duckdb.connect(":memory:") as con:
        assert con.execute("SELECT 1").fetchone() == (1,)
