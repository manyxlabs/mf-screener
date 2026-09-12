"""Preset screens. These are editable starting points, not recommendations.

A preset carrying `slot` is also one sleeve of the four-fund portfolio on /picks. `highlight`
names the few columns that decide that sleeve, which differ by mandate: a momentum sleeve
whose funds are all younger than three years has to be judged on columns a ten-year value
fund would be judged on last.
"""

from __future__ import annotations

from typing import Any, Final

_CONSISTENCY_COLUMNS = [
    "scheme_name",
    "clean_sub_category",
    "cap_band",
    "style",
    "latest_aum",
    "fund_age_years",
    "cagr_3y",
    "cagr_5y",
    "cagr_10y",
    "fund_minus_category_3y",
    "fund_minus_category_5y",
    "fund_minus_category_10y",
    "rolling_1y_median",
    "rolling_3y_median",
    "rolling_5y_median",
    "rolling_10y_median",
    "rolling_5y_min",
    "information_ratio_vs_category_5y",
    "sharpe_5y",
    "sortino_5y",
    "volatility_5y",
    "max_drawdown_5y",
    "data_quality_flags",
    "missing_reasons",
]

# A fund younger than its horizon has no 5-year anything, so ranking a young mandate on
# five-year columns would sort it entirely on nulls. These lead with what such a fund does
# have, and keep the age and observation count in view so the thinness stays visible.
_YOUNG_MANDATE_COLUMNS = [
    "scheme_name",
    "clean_sub_category",
    "cap_band",
    "style",
    "latest_aum",
    "expense_ratio",
    "fund_age_years",
    "monthly_obs_count",
    "cagr_1y",
    "cagr_3y",
    "rolling_1y_median",
    "rolling_1y_min",
    "rolling_3y_median",
    "information_ratio_vs_category_3y",
    "fund_minus_category_3y",
    "sharpe_3y",
    "volatility_3y",
    "max_drawdown_3y",
    "data_quality_flags",
    "missing_reasons",
]

PRESETS: Final[list[dict[str, Any]]] = [
    {
        "id": "long-term-consistency",
        "name": "A. Long-term Indian equity consistency",
        "description": (
            "Funds at least 7 years old that beat their sub-category over 5 and 10 years "
            "and whose median rolling 5-year return is positive. Ignores 1-year return."
        ),
        "filters": {
            "plans": ["Direct"],
            "options": ["Growth"],
            "active_only": True,
            "ranges": {
                "fund_age_years_min": 7,
                "cagr_5y_min": 0,
                "fund_minus_category_5y_min": 0,
                "fund_minus_category_10y_min": 0,
                "rolling_5y_median_min": 0,
                "sharpe_5y_min": 0,
            },
        },
        "sort": "rolling_5y_median:desc,fund_minus_category_5y:desc",
        "columns": _CONSISTENCY_COLUMNS,
    },
    {
        "id": "mid-multi-momentum",
        "slot": "Momentum sleeve",
        "highlight": ["cagr_1y", "cagr_3y", "volatility_3y", "max_drawdown_3y", "expense_ratio"],
        "name": "B. Mid / multi-cap momentum",
        "description": (
            "Momentum mandates in the mid, multi and mid-small bands. Almost all of these "
            "are index funds launched since 2023, so there is no age floor here: one would "
            "empty the screen rather than raise its quality. Judge them on the short record "
            "they have and on tracking behaviour, not on five-year columns that are blank."
        ),
        "filters": {
            "cap_bands": ["Mid Cap", "Multi Cap", "Mid & Small Cap"],
            "styles": ["Momentum"],
            "plans": ["Direct"],
            "options": ["Growth"],
            "active_only": True,
            "ranges": {},
        },
        "sort": "cagr_3y:desc,cagr_1y:desc,fund_age_years:desc",
        "columns": _YOUNG_MANDATE_COLUMNS,
    },
    {
        "id": "small-cap-quality",
        "slot": "Small-cap sleeve",
        "highlight": [
            "rolling_5y_median",
            "rolling_5y_min",
            "rolling_5y_positive_pct",
            "max_drawdown_5y",
            "expense_ratio",
        ],
        "name": "C. Small-cap quality",
        "description": (
            "The whole small-cap band, active and passive, aged 5+ years and beating the "
            "sub-category over 5 years. Growth is not a filter here: separating growth from "
            "blend needs the price-to-book of the holdings, which AMFI does not publish, and "
            "an Indian small-cap mandate is growth-oriented by construction anyway."
        ),
        "filters": {
            "cap_bands": ["Small Cap"],
            "plans": ["Direct"],
            "options": ["Growth"],
            "active_only": True,
            "ranges": {
                "fund_age_years_min": 5,
                "fund_minus_category_5y_min": 0,
            },
        },
        "sort": "rolling_5y_median:desc,max_drawdown_5y:desc,information_ratio_vs_category_5y:desc",
        "columns": [*_CONSISTENCY_COLUMNS, "rolling_5y_positive_pct"],
    },
    {
        "id": "value-mandates",
        "slot": "Value sleeve",
        "highlight": [
            "rolling_5y_median",
            "rolling_10y_median",
            "fund_minus_category_5y",
            "max_drawdown_5y",
            "expense_ratio",
        ],
        "name": "D. Value mandates",
        "description": (
            "Every fund whose mandate is value or contra, aged 7+ years. There is no cap band "
            "on this screen because SEBI's Value and Contra categories carry none: a value "
            "mandate is go-anywhere, so a flexi-cap value fund is filed as a Value Fund and "
            "would be excluded by a Flexi Cap filter. Category excess is shown but not "
            "filtered on: Contra is a four-fund category, so every contra fund's peer-relative "
            "column is blank for want of peers and a threshold would drop the category whole."
        ),
        "filters": {
            "styles": ["Value"],
            "plans": ["Direct"],
            "options": ["Growth"],
            "active_only": True,
            "ranges": {"fund_age_years_min": 7},
        },
        "sort": "rolling_5y_median:desc,rolling_10y_median:desc,sharpe_5y:desc",
        "columns": _CONSISTENCY_COLUMNS,
    },
    {
        "id": "sp500-comparison",
        "slot": "US sleeve",
        "highlight": ["cagr_3y", "cagr_5y", "tracking_error_3y", "volatility_5y", "expense_ratio"],
        "name": "E. S&P 500 comparison",
        "description": (
            "Funds whose name mentions the S&P 500. Ranked on tracking quality, not on alpha "
            "against an Indian index, which would be meaningless here. If the only S&P 500 "
            "series loaded is in USD, every benchmark-relative column here is blank by design: "
            "the comparison would include the exchange rate. Import an INR-converted index."
        ),
        "filters": {
            "search": "s&p 500",
            "plans": ["Direct"],
            "options": ["Growth"],
            "active_only": True,
            "ranges": {},
        },
        "sort": "tracking_error_3y:asc",
        "columns": [
            "scheme_name",
            "clean_sub_category",
            "fund_age_years",
            "latest_aum",
            "cagr_1y",
            "cagr_3y",
            "cagr_5y",
            "tracking_error_3y",
            "tracking_error_5y",
            "information_ratio_vs_benchmark_3y",
            "information_ratio_vs_benchmark_5y",
            "benchmark_id",
            "data_quality_flags",
            "missing_reasons",
        ],
    },
]

PRESETS_BY_ID: Final[dict[str, dict[str, Any]]] = {p["id"]: p for p in PRESETS}
