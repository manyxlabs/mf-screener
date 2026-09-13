"""Peer-universe methodology: the toggles, the eligibility filter and the category key."""

from __future__ import annotations

from typing import Literal

import pandas as pd
from pydantic import BaseModel, Field

from .classify import OPT_GROWTH, PLAN_DIRECT, PLAN_REGULAR

CategoryLevel = Literal["sub_category", "category"]
PlanScope = Literal["direct", "direct_regular", "all"]
OptionScope = Literal["growth", "all"]
Aggregation = Literal["mean", "median"]


class PeerUniverse(BaseModel):
    """How peers are chosen and averaged. Defaults never mix plans or options."""

    model_config = {"frozen": True}

    level: CategoryLevel = "sub_category"
    plan_scope: PlanScope = "direct"
    option_scope: OptionScope = "growth"
    active_only: bool = True
    aggregation: Aggregation = "mean"
    exclude_self: bool = True
    min_peers: int = Field(default=5, ge=2)

    def category_key(self, value: str) -> str:
        """Stable identifier for one peer group under this methodology."""
        return (
            f"{self.level}={value}|plan={self.plan_scope}"
            f"|option={self.option_scope}|active={'y' if self.active_only else 'n'}"
            f"|agg={self.aggregation}"
        )

    def label_column(self) -> str:
        """The column holding one peer group's label.

        The fine level is `peer_group`, not `clean_sub_category`: SEBI files a fund by
        its legal wrapper, so the raw sub-category pools a gold FoF with a Nasdaq feeder.
        See `classify.peer_group`.
        """
        return "peer_group" if self.level == "sub_category" else "clean_category"

    def filter(self, master: pd.DataFrame) -> pd.DataFrame:
        """Rows of the scheme master eligible for this peer universe."""
        df = master
        if self.plan_scope == "direct":
            df = df[df["clean_plan"] == PLAN_DIRECT]
        elif self.plan_scope == "direct_regular":
            df = df[df["clean_plan"].isin([PLAN_DIRECT, PLAN_REGULAR])]
        if self.option_scope == "growth":
            df = df[df["clean_option"] == OPT_GROWTH]
        if self.active_only:
            df = df[df["is_active"].astype("boolean").fillna(False)]
        return df

    def survivorship_counterpart(self) -> PeerUniverse:
        """Same methodology with only the active/matured toggle flipped.

        Pairs a category_key with the one other key that isolates survivorship
        bias: everything else about the peer group held fixed.
        """
        return self.model_copy(update={"active_only": not self.active_only})


DEFAULT_UNIVERSE = PeerUniverse()

_ACTIVE_MARKER = "|active=y|"
_ALL_SCHEMES_MARKER = "|active=n|"


def counterpart_category_key(category_key: str) -> str:
    """Flip a category_key's active marker, e.g. active-only <-> all-schemes.

    Raises ValueError if the key was not produced by PeerUniverse.category_key.
    """
    if _ACTIVE_MARKER in category_key:
        return category_key.replace(_ACTIVE_MARKER, _ALL_SCHEMES_MARKER)
    if _ALL_SCHEMES_MARKER in category_key:
        return category_key.replace(_ALL_SCHEMES_MARKER, _ACTIVE_MARKER)
    raise ValueError(f"category_key has no active marker: {category_key!r}")


def is_active_only_key(category_key: str) -> bool:
    """Whether category_key names the active-only side of a survivorship pair."""
    return _ACTIVE_MARKER in category_key
