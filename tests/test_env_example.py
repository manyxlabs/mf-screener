"""`.env.example` is the only description a fresh bootstrap gets of what is configurable."""

from __future__ import annotations

from pathlib import Path

from mf_analytics.config import REPO_ROOT, Settings


def _declared_keys(path: Path) -> set[str]:
    return {
        line.split("=", 1)[0].strip()
        for line in path.read_text().splitlines()
        if line.strip() and not line.lstrip().startswith("#") and "=" in line
    }


def test_every_documented_setting_is_in_env_example() -> None:
    """A setting absent here is invisible: nothing tells the reader it can be changed."""
    declared = _declared_keys(REPO_ROOT / ".env.example")
    # Fields without the prefix are internal paths with defaults, not knobs to publish.
    expected = {name.upper() for name in Settings.model_fields if name.startswith("mf_")}
    assert not expected - declared, sorted(expected - declared)


def test_env_example_declares_no_mf_setting_the_code_does_not_read() -> None:
    """A stale MF_* key reads as a supported knob that silently does nothing. Keys
    without the prefix belong to the web app, which reads its own environment."""
    declared = {k for k in _declared_keys(REPO_ROOT / ".env.example") if k.startswith("MF_")}
    known = {name.upper() for name in Settings.model_fields}
    assert not declared - known, sorted(declared - known)
