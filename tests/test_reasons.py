"""Every reason the app can emit resolves to a sentence, wherever it is looked up."""

from __future__ import annotations

import pkgutil
from importlib import import_module

import mf_analytics
from mf_analytics.quality import DESCRIPTIONS, all_reason_descriptions


def _modules_with_local_reasons() -> dict[str, dict[str, str]]:
    """Every module in the package that keeps a reason vocabulary of its own."""
    found: dict[str, dict[str, str]] = {}
    for info in pkgutil.walk_packages(mf_analytics.__path__, f"{mf_analytics.__name__}."):
        local = getattr(import_module(info.name), "REASON_DESCRIPTIONS", None)
        if isinstance(local, dict) and local:
            found[info.name] = local
    return found


def test_every_module_local_reason_is_in_the_canonical_mapping() -> None:
    """The failure this guards: a module adds a reason, and only the one merge site whose
    author remembered it resolves the reason to a sentence. Everywhere else the user is
    shown the raw snake_case name."""
    canonical = all_reason_descriptions()
    for name, local in _modules_with_local_reasons().items():
        missing = set(local) - set(canonical)
        assert not missing, (
            f"{name} defines {sorted(missing)}, absent from all_reason_descriptions()"
        )


def test_the_canonical_mapping_is_the_shared_vocabulary_plus_the_local_ones() -> None:
    expected = dict(DESCRIPTIONS)
    for local in _modules_with_local_reasons().values():
        expected.update(local)
    assert all_reason_descriptions() == expected


def test_at_least_one_module_keeps_a_local_reason() -> None:
    """Guards the discovery itself: if walk_packages stopped finding modules, the two
    tests above would pass vacuously."""
    assert len(_modules_with_local_reasons()) >= 5


def test_every_reason_description_is_a_sentence_not_a_restatement() -> None:
    for reason, text in all_reason_descriptions().items():
        assert text.strip(), reason
        assert text.strip() != reason, f"{reason} is described by its own name"
