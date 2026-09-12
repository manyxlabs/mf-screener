"""Normalise AMFI scheme metadata into the app's canonical plan/option/category fields."""

from __future__ import annotations

import re

import pandas as pd

PLAN_DIRECT = "Direct"
PLAN_REGULAR = "Regular"
PLAN_UNKNOWN = "Unknown"

OPT_GROWTH = "Growth"
OPT_IDCW_PAYOUT = "IDCW Payout"
OPT_IDCW_REINVEST = "IDCW Reinvestment"
OPT_BONUS = "Bonus"
OPT_OTHER = "Other"
OPT_UNKNOWN = "Unknown"

_DIRECT = re.compile(r"\bdirect\b", re.I)
_REGULAR = re.compile(r"\b(regular|retail)\b", re.I)
_GROWTH = re.compile(r"\bgrowth\b|\bcumulative\b", re.I)
_REINVEST = re.compile(r"\bre-?invest", re.I)
_PAYOUT = re.compile(r"\bpay-?out\b", re.I)
_IDCW = re.compile(r"\bidcw\b|\bdividend\b|\bdiv\b", re.I)


def clean_plan(source_plan: object, scheme_name: object) -> str:
    """Source `scheme_plan` first; the scheme name only breaks ties it leaves open.

    Pre-2013 schemes predate the Direct/Regular split and stay Unknown by design.
    """
    plan = str(source_plan or "").strip().lower()
    if plan == "direct":
        return PLAN_DIRECT
    if plan == "regular":
        return PLAN_REGULAR
    name = str(scheme_name or "")
    if _DIRECT.search(name):
        return PLAN_DIRECT
    if _REGULAR.search(name):
        return PLAN_REGULAR
    return PLAN_UNKNOWN


def clean_option(source_option: object, scheme_name: object) -> str:
    """AMFI publishes only Growth/IDCW/Bonus/Other; payout vs reinvestment lives in the name."""
    option = str(source_option or "").strip().lower()
    name = str(scheme_name or "")
    if option == "growth":
        return OPT_GROWTH
    if option == "idcw":
        if _REINVEST.search(name):
            return OPT_IDCW_REINVEST
        if _PAYOUT.search(name):
            return OPT_IDCW_PAYOUT
        return OPT_IDCW_PAYOUT
    if option == "bonus":
        # AMFI said Bonus, so the name cannot overrule it. Many of these are filed as
        # "... Growth Plan - Bonus Option", and reading the name first put 64 bonus
        # schemes into the Growth peer universe, double-counting their fund.
        return OPT_BONUS
    if option == "other":
        if _GROWTH.search(name) and not _IDCW.search(name):
            return OPT_GROWTH
        if _REINVEST.search(name):
            return OPT_IDCW_REINVEST
        if _IDCW.search(name):
            return OPT_IDCW_PAYOUT
        return OPT_OTHER
    if _GROWTH.search(name) and not _IDCW.search(name):
        return OPT_GROWTH
    if _REINVEST.search(name):
        return OPT_IDCW_REINVEST
    if _IDCW.search(name):
        return OPT_IDCW_PAYOUT
    return OPT_UNKNOWN


def clean_category(category_group_clean: object, category: object) -> str:
    value = str(category_group_clean or "").strip()
    return value or (str(category or "").strip() or "Unclassified")


def clean_sub_category(category_sub: object, category: object) -> str:
    """`category_sub` is blank for ~25k old-style filings; their raw text is the fallback."""
    value = str(category_sub or "").strip()
    if value and value.lower() != "nan":
        return value
    raw = str(category or "").strip()
    return raw if raw and raw.lower() != "nan" else "Unclassified"


# The two axes of the conventional style box. A real style box is computed from portfolio
# holdings; AMFI publishes none, so these read the mandate the scheme states in its
# sub-category and its own name. They describe what the fund says it does, never what its
# portfolio currently looks like.
CAP_LARGE = "Large Cap"
CAP_LARGE_MID = "Large & Mid Cap"
CAP_MID = "Mid Cap"
CAP_MID_SMALL = "Mid & Small Cap"
CAP_SMALL = "Small Cap"
CAP_MULTI = "Multi Cap"
CAP_FLEXI = "Flexi Cap"
CAP_BROAD = "Broad Market"

STYLE_MOMENTUM = "Momentum"
STYLE_VALUE = "Value"
STYLE_QUALITY = "Quality"
STYLE_LOW_VOLATILITY = "Low Volatility"
STYLE_DIVIDEND_YIELD = "Dividend Yield"
STYLE_BLEND = "Blend"

_SUB_CAP_BAND = {
    "Large Cap Fund": CAP_LARGE,
    "Large & Mid Cap Fund": CAP_LARGE_MID,
    "Mid Cap Fund": CAP_MID,
    "Small Cap Fund": CAP_SMALL,
    "Multi Cap Fund": CAP_MULTI,
    "Flexi Cap Fund": CAP_FLEXI,
}

# Ordered: the first match wins, so a narrower band is tested before one that contains it.
# "Nifty LargeMidcap 250" has to be read as Large & Mid before "midcap" claims it, and
# "Nifty Next 50" is ranks 51-100, which SEBI counts as large cap rather than mid.
_NAME_CAP_BAND: tuple[tuple[str, re.Pattern[str]], ...] = tuple(
    (label, re.compile(pattern, re.I))
    for label, pattern in (
        (CAP_MID_SMALL, r"mid\s*small\s*cap|midsmallcap|mid\s*&\s*small"),
        (CAP_LARGE_MID, r"large\s*(and\s*|&\s*)?mid|nifty\s*200|bse\s*200"),
        (CAP_SMALL, r"small\s*cap"),
        (CAP_MID, r"mid\s*cap|midcap"),
        (CAP_MULTI, r"multi\s*cap|multicap"),
        (CAP_FLEXI, r"flexi\s*cap|flexicap"),
        (CAP_BROAD, r"nifty\s*500|bse\s*500|total\s*market|nifty\s*750"),
        (
            CAP_LARGE,
            r"large\s*cap|nifty\s*50\b|sensex|nifty\s*100|bse\s*100"
            r"|blue\s*chip|bluechip|top\s*50|top\s*100|next\s*50",
        ),
    )
)

_SUB_STYLE = {
    "Value Fund": STYLE_VALUE,
    "Contra Fund": STYLE_VALUE,
    "Dividend Yield Fund": STYLE_DIVIDEND_YIELD,
}

# Momentum leads: a "Momentum Quality 100" index selects on momentum first.
_NAME_STYLE: tuple[tuple[str, re.Pattern[str]], ...] = tuple(
    (label, re.compile(pattern, re.I))
    for label, pattern in (
        (STYLE_MOMENTUM, r"momentum"),
        (STYLE_VALUE, r"\bvalue\b|\bcontra\b"),
        (STYLE_QUALITY, r"\bquality\b"),
        (STYLE_LOW_VOLATILITY, r"low\s*vol|minimum\s*variance|min\s*vol"),
        (STYLE_DIVIDEND_YIELD, r"dividend\s*yield"),
    )
)

# A renamed scheme carries its old name in brackets, and that old name has its own
# mandate words: "Sundaram Focused Fund (Formerly ... Principal Focused Multicap Fund)".
_PARENTHETICAL = re.compile(r"\([^)]*\)")


def cap_band(sub_category: object, scheme_name: object) -> str | None:
    """The declared market-cap band, or None where the scheme states none.

    The sub-category decides it whenever SEBI's own name carries a band. Only the
    passive and thematic sub-categories, which do not, fall through to the name.
    """
    sub = str(sub_category or "").strip()
    if sub in _SUB_CAP_BAND:
        return _SUB_CAP_BAND[sub]
    name = _PARENTHETICAL.sub(" ", str(scheme_name or ""))
    for label, pattern in _NAME_CAP_BAND:
        if pattern.search(name):
            return label
    return None


def style(category: object, sub_category: object, scheme_name: object) -> str | None:
    """The declared factor tilt, Blend for an equity scheme that declares none, None otherwise.

    Growth is deliberately absent. Separating growth from blend needs the price-to-book and
    price-to-earnings of the holdings, so claiming it from a name would be a guess.
    """
    name = str(scheme_name or "")
    for label, pattern in _NAME_STYLE:
        if pattern.search(name):
            return label
    sub = str(sub_category or "").strip()
    if sub in _SUB_STYLE:
        return _SUB_STYLE[sub]
    return STYLE_BLEND if str(category or "").strip() == "Equity Scheme" else None


# T2.1 fund family identity: Direct/Regular and Growth/IDCW are separate scheme codes
# for one economic fund. These strip the plan/option vocabulary above (and generic
# filler words) so the remaining text names the fund itself, not how it is sold.
_FAMILY_NOISE_WORDS = frozenset(
    {
        "direct",
        "regular",
        "retail",
        "plan",
        "growth",
        "cumulative",
        "option",
        "idcw",
        "dividend",
        "div",
        "payout",
        "reinvestment",
        "reinvest",
        "bonus",
        "fund",
    }
)
_NON_ALNUM = re.compile(r"[^a-z0-9]+")

# Below this length a stripped name is generic enough ("liquid", "gilt") that matching
# it exactly across two different AMCs' funds, or even two unrelated funds from the
# same one, would be a guess rather than a finding. Grouping by name simply does not
# fire for these; they fall back to being their own ungrouped family.
_MIN_FAMILY_NAME_KEY_LEN = 6


def normalise_fund_name(scheme_name: object) -> str:
    """Collapse a scheme name to the words that name the fund, plan/option words gone.

    A parenthetical carries a former, unrelated name after a rename ("Formerly ...")
    and must not leak into the key, exactly as `cap_band` and `style` also exclude it.
    """
    name = _PARENTHETICAL.sub(" ", str(scheme_name or "")).lower()
    words = [w for w in _NON_ALNUM.split(name) if w and w not in _FAMILY_NOISE_WORDS]
    return " ".join(words)


def fund_family_key(amc: object, scheme_name: object) -> str | None:
    """AMC + normalised name, or None when that name is too short to trust for grouping.

    Exact match only. A name that only *resembles* another is left out here on purpose:
    the caller must not merge on a guess, and fuzzy matching is exactly that guess.
    """
    key = normalise_fund_name(scheme_name)
    if len(key) < _MIN_FAMILY_NAME_KEY_LEN:
        return None
    return f"{str(amc or '').strip().lower()}|{key}"


def _blank(value: object) -> bool:
    text = str(value or "").strip()
    return not text or text.lower() == "nan"


class _UnionFind:
    """Minimal union-find over row positions, used only to group scheme_master rows."""

    def __init__(self, n: int) -> None:
        self._parent = list(range(n))

    def find(self, i: int) -> int:
        root = i
        while self._parent[root] != root:
            root = self._parent[root]
        while self._parent[i] != root:
            self._parent[i], i = root, self._parent[i]
        return root

    def union(self, i: int, j: int) -> None:
        ri, rj = self.find(i), self.find(j)
        if ri != rj:
            self._parent[max(ri, rj)] = min(ri, rj)


def derive_fund_family_ids(df: pd.DataFrame) -> pd.Series:
    """One fund_family_id per row, tying plan/option variants of one fund together.

    Two ties are used, in order of trust:
    1. ISIN: two rows that share a value in either ISIN column are the same unit
       under two option labels (a Growth ISIN and an IDCW ISIN issued together).
    2. AMC + normalised name: ties the Direct and Regular, or Growth and IDCW,
       spelling of the same fund's name together.
    A row that matches nothing on either tie keeps its own scheme_code as a family
    of one - left ungrouped rather than merged on a guess, per the data policy.
    """
    n = len(df)
    codes = df["scheme_code"].astype(str).tolist()
    uf = _UnionFind(n)

    empty = pd.Series("", index=df.index)
    isin_growth = df["isin_growth"] if "isin_growth" in df.columns else empty
    isin_dividend = df["isin_dividend"] if "isin_dividend" in df.columns else empty
    amc = df["amc"] if "amc" in df.columns else pd.Series("", index=df.index)
    names = df["scheme_name"]

    first_seen_isin: dict[str, int] = {}
    for i in range(n):
        for isin in (isin_growth.iloc[i], isin_dividend.iloc[i]):
            if _blank(isin):
                continue
            value = str(isin).strip()
            if value in first_seen_isin:
                uf.union(i, first_seen_isin[value])
            else:
                first_seen_isin[value] = i

    first_seen_name: dict[str, int] = {}
    for i in range(n):
        key = fund_family_key(amc.iloc[i], names.iloc[i])
        if key is None:
            continue
        if key in first_seen_name:
            uf.union(i, first_seen_name[key])
        else:
            first_seen_name[key] = i

    groups: dict[int, list[int]] = {}
    for i in range(n):
        groups.setdefault(uf.find(i), []).append(i)

    family_id = [""] * n
    for members in groups.values():
        rep = f"fam:{min(codes[m] for m in members)}"
        for m in members:
            family_id[m] = rep
    return pd.Series(family_id, index=df.index)


def classify_frame(df: pd.DataFrame) -> pd.DataFrame:
    """Add the clean_* normalisation columns and the two style-box axes."""
    out = df.copy()
    out["clean_plan"] = [
        clean_plan(p, n) for p, n in zip(out["scheme_plan"], out["scheme_name"], strict=True)
    ]
    out["clean_option"] = [
        clean_option(o, n) for o, n in zip(out["scheme_option"], out["scheme_name"], strict=True)
    ]
    out["clean_category"] = [
        clean_category(g, c)
        for g, c in zip(out["category_group_clean"], out["category"], strict=True)
    ]
    out["clean_sub_category"] = [
        clean_sub_category(s, c) for s, c in zip(out["category_sub"], out["category"], strict=True)
    ]
    out["cap_band"] = [
        cap_band(s, n) for s, n in zip(out["clean_sub_category"], out["scheme_name"], strict=True)
    ]
    out["style"] = [
        style(c, s, n)
        for c, s, n in zip(
            out["clean_category"], out["clean_sub_category"], out["scheme_name"], strict=True
        )
    ]
    out["fund_family_id"] = derive_fund_family_ids(out)
    return out
