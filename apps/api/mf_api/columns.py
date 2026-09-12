"""The screener's column vocabulary: what can be selected, filtered and sorted.

Everything the client may name in a query is whitelisted here. Client strings are
never interpolated into SQL; they only ever select an entry from these tuples.
"""

from __future__ import annotations

from typing import Final, Literal

from mf_analytics.config import HORIZONS, ROLLING_HORIZONS, TRAILING_HORIZONS
from mf_analytics.metrics.persistence import PERSISTENCE_WINDOW_YEARS
from mf_analytics.pipeline import CAPTURE_HORIZONS, MIN_CALENDAR_YEARS

# Every capture/calendar-year caveat below says this once instead of retyping it.
_CALENDAR_YEAR_CAVEAT = (
    f"Needs at least {MIN_CALENDAR_YEARS} complete (12-month) calendar years; the "
    "fund's first and last, almost always partial, are never counted."
)
_PEER_CAPTURE_CAVEAT = (
    "Against the leave-one-out sub-category peer average, not a benchmark index - "
    "capture against peers and capture against a benchmark are different numbers."
)
_QUARTILE_CAVEAT = (
    "Ranked inside the fund's own sub-category, requiring the same minimum peer count "
    "as every other peer-relative metric; blank below it."
)

# Appended to every benchmark-relative metric: the null has a cause worth naming.
FX_CAVEAT = " Blank when the mapped benchmark is in another currency."

# Screening a t-stat or p-value across the whole universe without saying this is how
# a multiple-comparisons problem hides. No correction is applied; the count is shown
# instead so the user can weigh it. See mf_api.methodology for the worked number.
_ALPHA_MULTIPLE_COMPARISONS_CAVEAT = (
    " No multiple-comparisons correction is applied: screened across the full universe, "
    "roughly 5% of funds are expected to clear p < 0.05 by chance alone even with zero "
    "true skill. See the methodology page for the expected false-positive count."
)

# AMFI publishes only a quarterly average for one scheme variant. Naming the field
# fully is the whole protection against it being read as a current, fund-wide AUM.
AAUM_LABEL: Final = "Scheme AAUM (Quarterly Average, ₹ Cr)"

Direction = Literal["higher_is_better", "lower_is_better", "context"]


class ColumnSpec:
    __slots__ = (
        "caveat",
        "definition",
        "direction",
        "frequency",
        "label",
        "name",
        "period",
        "unit",
    )

    def __init__(
        self,
        name: str,
        label: str,
        unit: str,
        definition: str,
        period: str,
        frequency: str,
        direction: Direction,
        caveat: str,
    ) -> None:
        self.name = name
        self.label = label
        self.unit = unit
        self.definition = definition
        self.period = period
        self.frequency = frequency
        self.direction = direction
        self.caveat = caveat

    def as_dict(self) -> dict[str, str]:
        return {s: getattr(self, s) for s in self.__slots__}


def _cagr(h: int) -> ColumnSpec:
    return ColumnSpec(
        f"cagr_{h}y",
        f"CAGR {h}Y",
        "percent",
        "Annualised trailing return from month-end NAV to month-end NAV.",
        f"{h} years to the snapshot date",
        "monthly",
        "higher_is_better",
        "Past return. It says nothing about future return, and it ignores risk taken.",
    )


def _sip_xirr(h: int) -> ColumnSpec:
    return ColumnSpec(
        f"sip_xirr_{h}y",
        f"SIP XIRR {h}Y",
        "percent",
        "Annualised return on a fixed monthly contribution made at each month-end NAV "
        "in the window, redeemed at the window's last observation.",
        f"{h} years to the snapshot date",
        "monthly",
        "higher_is_better",
        "Not the same number as trailing CAGR: it reflects the timing of monthly "
        "contributions, not a single lump sum in and out. Blank below 12 contributions "
        "or when no annualised rate prices the cash flows to zero.",
    )


def _rolling_sip_xirr(h: int) -> ColumnSpec:
    return ColumnSpec(
        f"rolling_sip_xirr_{h}y_median",
        f"Rolling {h}Y SIP XIRR Median",
        "percent",
        f"Median SIP XIRR of every overlapping {h}-year contribution window in the fund's history.",
        f"all {h}-year windows",
        "monthly",
        "higher_is_better",
        "Overlapping windows are correlated, so this is not a sample of independent outcomes.",
    )


def _rolling(h: int, stat: str, label: str, direction: Direction, caveat: str) -> ColumnSpec:
    return ColumnSpec(
        f"rolling_{h}y_{stat}",
        f"Rolling {h}Y {label}",
        "percent",
        f"{label} of every overlapping {h}-year annualised return in the fund's history.",
        f"all {h}-year windows",
        "monthly",
        direction,
        caveat,
    )


NUMERIC_COLUMNS: Final[tuple[ColumnSpec, ...]] = (
    *(_cagr(h) for h in TRAILING_HORIZONS),
    *(_sip_xirr(h) for h in TRAILING_HORIZONS),
    *(_rolling_sip_xirr(h) for h in (3, 5)),
    *(
        spec
        for h in ROLLING_HORIZONS
        for spec in (
            _rolling(
                h,
                "mean",
                "mean",
                "higher_is_better",
                "Overlapping windows are correlated, so this is not a sample of independent outcomes.",
            ),
            _rolling(
                h,
                "median",
                "median",
                "higher_is_better",
                "Less sensitive to one exceptional market phase than the mean.",
            ),
            _rolling(
                h,
                "min",
                "minimum",
                "higher_is_better",
                "The single worst window in the available history - not a floor on future outcomes.",
            ),
            _rolling(
                h,
                "max",
                "maximum",
                "context",
                "The best window. Useful for range, useless as an expectation.",
            ),
            _rolling(
                h,
                "std",
                "dispersion",
                "lower_is_better",
                "Standard deviation across overlapping windows; windows share months, so it understates independence.",
            ),
            _rolling(
                h,
                "positive_pct",
                "positive %",
                "higher_is_better",
                "Share of windows with a return above zero, not above inflation.",
            ),
            _rolling(
                h,
                "beat_category_pct",
                "beat sub-category %",
                "higher_is_better",
                "Compared against the equal-weighted peer index, which is itself survivorship-affected.",
            ),
            _rolling(
                h,
                "beat_benchmark_pct",
                "beat benchmark %",
                "higher_is_better",
                "Only as good as the mapped benchmark series.",
            ),
        )
    ),
    *(
        spec
        for h in CAPTURE_HORIZONS
        for spec in (
            ColumnSpec(
                f"upside_capture_{h}y",
                f"Upside capture {h}Y",
                "ratio",
                "Fund's compounded return over months its sub-category peer average "
                "rose, divided by the peer average's own compounded return over those "
                "same months.",
                f"{h} years",
                "monthly",
                "higher_is_better",
                _PEER_CAPTURE_CAVEAT,
            ),
            ColumnSpec(
                f"downside_capture_{h}y",
                f"Downside capture {h}Y",
                "ratio",
                "Fund's compounded return over months its sub-category peer average "
                "fell, divided by the peer average's own compounded return over those "
                "same months.",
                f"{h} years",
                "monthly",
                "lower_is_better",
                "Below 1 means the fund lost less than peers when they fell, the "
                "desirable direction. " + _PEER_CAPTURE_CAVEAT,
            ),
        )
    ),
    ColumnSpec(
        "max_drawdown_5y_recovery_days",
        "Drawdown recovery (days) 5Y",
        "days",
        "Calendar days from the trough of the worst peak-to-trough fall in the last 5 "
        "years to the first daily NAV that regained the pre-fall peak.",
        "5 years",
        "daily",
        "lower_is_better",
        "Blank, never a large number, when the fund has not yet regained that peak.",
    ),
    ColumnSpec(
        "worst_calendar_year_return",
        "Worst calendar year",
        "percent",
        "Lowest compounded return of any complete calendar year in the fund's history.",
        "since inception",
        "monthly",
        "higher_is_better",
        _CALENDAR_YEAR_CAVEAT,
    ),
    ColumnSpec(
        "worst_calendar_year",
        "Worst calendar year (year)",
        "year",
        "Calendar year of the fund's worst complete-year return.",
        "since inception",
        "monthly",
        "context",
        _CALENDAR_YEAR_CAVEAT,
    ),
    ColumnSpec(
        "positive_calendar_years_pct",
        "Positive calendar years",
        "percent",
        "Share of complete calendar years with a positive compounded return.",
        "since inception",
        "monthly",
        "higher_is_better",
        _CALENDAR_YEAR_CAVEAT,
    ),
    ColumnSpec(
        "style_drift_3y",
        "Style drift (3Y)",
        "ratio",
        "Mean turnover between consecutive rolling 36-month style-factor fits over the "
        "last 3 years: half the sum of absolute weight changes across the basis, so a "
        "complete switch from one factor to another reads as 1 and an unchanged mix as 0.",
        "3 years of monthly-stepped 36-month windows",
        "monthly",
        "lower_is_better",
        "Inferred from NAV, not from holdings - the same style-analysis basis as the "
        "exposure fit, and blank for the same reasons: too little shared history with the "
        "basis, or fewer than 2 windows in the last 3 years that clear the R-squared floor.",
    ),
    ColumnSpec(
        "quartile_now_3y",
        "Quartile now (3Y)",
        "quartile",
        "Quartile of the fund's trailing 3-year return inside its sub-category as of "
        "the snapshot date, 1 being the best-performing quarter of peers.",
        "3 years to the snapshot date",
        "monthly",
        "lower_is_better",
        _QUARTILE_CAVEAT,
    ),
    ColumnSpec(
        "quartile_now_5y",
        "Quartile now (5Y)",
        "quartile",
        "Quartile of the fund's trailing 5-year return inside its sub-category as of "
        "the snapshot date, 1 being the best-performing quarter of peers.",
        "5 years to the snapshot date",
        "monthly",
        "lower_is_better",
        _QUARTILE_CAVEAT,
    ),
    ColumnSpec(
        "quartile_persistence_3y",
        "Quartile persistence (3Y)",
        "percent",
        f"Share of month ends in the last {PERSISTENCE_WINDOW_YEARS} years where the "
        "fund's trailing 3-year sub-category quartile matched the quartile it is in now.",
        f"{PERSISTENCE_WINDOW_YEARS} years",
        "monthly",
        "higher_is_better",
        _QUARTILE_CAVEAT + " Past performance chasing is the error this exists to check.",
    ),
    ColumnSpec(
        "quartile_top_share_3y",
        "Time in top quartile (3Y)",
        "percent",
        f"Share of month ends in the last {PERSISTENCE_WINDOW_YEARS} years where the "
        "fund's trailing 3-year return ranked in the top quartile of its sub-category.",
        f"{PERSISTENCE_WINDOW_YEARS} years",
        "monthly",
        "higher_is_better",
        _QUARTILE_CAVEAT,
    ),
    ColumnSpec(
        "quartile_transitions_3y",
        "Quartile changes (3Y)",
        "count",
        f"Number of month-to-month changes in the fund's trailing 3-year sub-category "
        f"quartile over the last {PERSISTENCE_WINDOW_YEARS} years.",
        f"{PERSISTENCE_WINDOW_YEARS} years",
        "monthly",
        "lower_is_better",
        _QUARTILE_CAVEAT + " Fewer changes means a more stable relative rank, not a better one.",
    ),
    *(
        spec
        for h in HORIZONS
        for spec in (
            ColumnSpec(
                f"fund_minus_category_{h}y",
                f"Excess vs sub-category {h}Y",
                "percentage_points",
                "Fund CAGR minus the leave-one-out average CAGR of its peer universe.",
                f"{h} years",
                "monthly",
                "higher_is_better",
                "Peers are today's surviving schemes; funds that closed are not in the average.",
            ),
            ColumnSpec(
                f"fund_div_category_{h}y",
                f"Ratio vs sub-category {h}Y",
                "ratio",
                "Fund CAGR divided by the peer average CAGR.",
                f"{h} years",
                "monthly",
                "higher_is_better",
                "Undefined and shown blank when the peer average is zero or negative.",
            ),
            ColumnSpec(
                f"category_return_{h}y",
                f"Sub-category CAGR {h}Y",
                "percent",
                "Average trailing CAGR of the peer universe, excluding this fund.",
                f"{h} years",
                "monthly",
                "context",
                "Equal-weighted across schemes by default, not weighted by AUM.",
            ),
            ColumnSpec(
                f"fund_minus_benchmark_{h}y",
                f"Excess vs benchmark {h}Y",
                "percentage_points",
                "Fund CAGR minus the mapped benchmark's CAGR.",
                f"{h} years",
                "monthly",
                "higher_is_better",
                "Blank when no benchmark series is loaded for the fund's category.",
            ),
            ColumnSpec(
                f"information_ratio_vs_category_{h}y",
                f"Information Ratio vs Sub-category {h}Y",
                "ratio",
                "Measures the consistency of monthly fund outperformance versus its sub-category peer return.",
                f"{h} years",
                "monthly",
                "higher_is_better",
                "It is not benchmark Information Ratio. The app uses an equal-weighted, leave-one-out peer return by default.",
            ),
            ColumnSpec(
                f"information_ratio_vs_benchmark_{h}y",
                f"IR vs benchmark {h}Y",
                "ratio",
                "Mean monthly active return over its standard deviation, annualised, against the mapped benchmark.",
                f"{h} years",
                "monthly",
                "higher_is_better",
                "A proxy benchmark is net of that index fund's costs, which flatters the fund slightly."
                + FX_CAVEAT,
            ),
            ColumnSpec(
                f"sharpe_{h}y",
                f"Sharpe {h}Y",
                "ratio",
                "Mean monthly return above the risk-free rate over the standard deviation of monthly returns, annualised.",
                f"{h} years",
                "monthly",
                "higher_is_better",
                "Penalises upside volatility as much as downside.",
            ),
            ColumnSpec(
                f"sortino_{h}y",
                f"Sortino {h}Y",
                "ratio",
                "Excess return over downside deviation, annualised.",
                f"{h} years",
                "monthly",
                "higher_is_better",
                "Downside deviation uses only months below the risk-free rate, so it rests on fewer observations.",
            ),
            ColumnSpec(
                f"volatility_{h}y",
                f"Volatility {h}Y",
                "percent",
                "Annualised standard deviation of monthly returns.",
                f"{h} years",
                "monthly",
                "lower_is_better",
                "Monthly data smooths intra-month drawdowns.",
            ),
            ColumnSpec(
                f"downside_deviation_{h}y",
                f"Downside deviation {h}Y",
                "percent",
                "Annualised standard deviation of shortfalls below the monthly risk-free rate.",
                f"{h} years",
                "monthly",
                "lower_is_better",
                "Estimated from below-threshold months only.",
            ),
            ColumnSpec(
                f"tracking_error_{h}y",
                f"Tracking error {h}Y",
                "percent",
                "Annualised standard deviation of the fund-minus-benchmark monthly return.",
                f"{h} years",
                "monthly",
                "lower_is_better",
                "For an active fund a low value means index-hugging, not skill." + FX_CAVEAT,
            ),
            ColumnSpec(
                f"alpha_{h}y",
                f"Alpha {h}Y",
                "percent",
                "Annualised intercept of the fund's excess return regressed on the benchmark's excess return.",
                f"{h} years",
                "monthly",
                "higher_is_better",
                "Only meaningful against a benchmark the fund actually tracks; check R-squared and beta."
                + FX_CAVEAT,
            ),
            ColumnSpec(
                f"beta_{h}y",
                f"Beta {h}Y",
                "ratio",
                "Slope of the fund's excess return regressed on the benchmark's excess return: "
                "sensitivity to the benchmark.",
                f"{h} years",
                "monthly",
                "context",
                "Above 1 means it amplified the index, in both directions." + FX_CAVEAT,
            ),
            ColumnSpec(
                f"r_squared_{h}y",
                f"R-squared {h}Y",
                "ratio",
                "Share of the fund's excess return variance explained by that same regression.",
                f"{h} years",
                "monthly",
                "context",
                "A low value means alpha and beta describe this fund poorly." + FX_CAVEAT,
            ),
            ColumnSpec(
                f"alpha_tstat_{h}y",
                f"Alpha t-stat {h}Y",
                "ratio",
                "T-statistic of the monthly alpha estimate against zero, from the same regression's "
                "residual standard error.",
                f"{h} years",
                "monthly",
                "context",
                _ALPHA_MULTIPLE_COMPARISONS_CAVEAT + FX_CAVEAT,
            ),
            ColumnSpec(
                f"alpha_pvalue_{h}y",
                f"Alpha p-value {h}Y",
                "ratio",
                "Two-sided p-value of the alpha t-statistic against the t-distribution with n-2 "
                "degrees of freedom.",
                f"{h} years",
                "monthly",
                "lower_is_better",
                _ALPHA_MULTIPLE_COMPARISONS_CAVEAT + FX_CAVEAT,
            ),
            ColumnSpec(
                f"max_drawdown_{h}y",
                f"Max drawdown {h}Y",
                "percent",
                "Worst peak-to-trough fall in daily NAV, carried as a negative number: -12% is a "
                "milder fall than -40%, which is why a higher value is the better one.",
                f"{h} years",
                "monthly",
                "higher_is_better",
                "Measured on daily NAV. The series starts at any NAV redenomination, so the step is never counted as a fall.",
            ),
            ColumnSpec(
                f"calmar_{h}y",
                f"Calmar {h}Y",
                "ratio",
                "Trailing CAGR divided by the absolute maximum drawdown.",
                f"{h} years",
                "monthly",
                "higher_is_better",
                "Unstable when the drawdown is small.",
            ),
        )
    ),
    ColumnSpec(
        "expense_ratio",
        "Expense ratio",
        "percent",
        "Total expense ratio for this scheme's plan, as disclosed by the AMC.",
        "latest disclosure",
        "daily",
        "lower_is_better",
        "Matched to the scheme by name, since the disclosure carries no scheme code. The "
        "source covers only part of the industry, so a blank means not published, not zero. "
        "Returns already sit net of it, so it is not a second deduction.",
    ),
    ColumnSpec(
        "fund_age_years",
        "Fund age",
        "years",
        "Years between the first and the latest NAV published for the scheme.",
        "since inception",
        "daily",
        "context",
        "AMFI publishes no launch date; the first NAV date stands in for it.",
    ),
    ColumnSpec(
        "latest_aum",
        AAUM_LABEL,
        "inr_crore",
        "This is AMFI quarterly average AUM for this exact scheme variant, such as Direct Growth.",
        "latest published quarter",
        "quarterly",
        "context",
        "It is not a current month-end AUM and does not include related Direct/Regular or Growth/IDCW variants.",
    ),
    ColumnSpec(
        "aum_family_latest",
        "Fund AUM (Family Total, Quarterly Average, ₹ Cr)",
        "inr_crore",
        "Sum of latest_aum across every scheme code sharing this fund's fund_family_id "
        "(Direct/Regular, Growth/IDCW) - the figure comparable to a factsheet total.",
        "latest published quarter",
        "quarterly",
        "context",
        "Still AMFI's SEBI-standardised quarterly average, so it will not match a "
        "month-end factsheet figure. Null where no variant in the family has a "
        "reported AUM.",
    ),
    ColumnSpec(
        "aum_growth_4q",
        "AUM Growth (4Q)",
        "percent",
        "Growth in aum_family_latest over the last 4 AMFI-published quarters.",
        "trailing 4 quarters",
        "quarterly",
        "context",
        "Needs 5 distinct quarterly AUM readings recorded for the fund's family; "
        "blank below that, such as for a fund newly tracked by this project.",
    ),
    ColumnSpec(
        "aum_percentile_in_sub_category",
        "AUM Percentile (Sub-Category)",
        "percent",
        "Percentile rank of aum_family_latest inside the fund's clean_sub_category, "
        "1.0 being the largest fund.",
        "as of the snapshot date",
        "quarterly",
        "lower_is_better",
        "Ranked on the family total, not this scheme code's own AUM. Requires the "
        "same minimum peer count as every other peer-relative metric; blank below it.",
    ),
    ColumnSpec(
        "latest_nav",
        "NAV",
        "inr",
        "Latest published net asset value.",
        "latest",
        "daily",
        "context",
        "For a matured scheme this is its final frozen NAV.",
    ),
    # T3.2 enrichment, joined from scheme_attributes the same way expense_ratio is
    # joined from scheme_ter above - never written into scheme_metrics_snapshot itself.
    ColumnSpec(
        "exit_load_pct",
        "Exit Load",
        "percent",
        "Exit load charged on redemption inside the exit load period, per the SID.",
        "current",
        "as published",
        "lower_is_better",
        "Third-party enrichment, not AMFI. Blank when the source does not carry this scheme.",
    ),
    ColumnSpec(
        "exit_load_period_days",
        "Exit Load Period",
        "days",
        "Days after purchase during which the exit load applies.",
        "current",
        "as published",
        "context",
        "Third-party enrichment, not AMFI. Blank when the source does not carry this scheme.",
    ),
    ColumnSpec(
        "lock_in_days",
        "Lock-in",
        "days",
        "Mandatory lock-in period from purchase, such as for ELSS schemes.",
        "current",
        "as published",
        "context",
        "Third-party enrichment, not AMFI. Blank when the source does not carry this scheme.",
    ),
    ColumnSpec(
        "min_investment",
        "Minimum Investment",
        "inr",
        "Minimum lump-sum investment stated in the SID.",
        "current",
        "as published",
        "context",
        "Third-party enrichment, not AMFI. Blank when the source does not carry this scheme.",
    ),
    ColumnSpec(
        "min_sip",
        "Minimum SIP",
        "inr",
        "Minimum monthly SIP instalment stated in the SID.",
        "current",
        "as published",
        "context",
        "Third-party enrichment, not AMFI. Blank when the source does not carry this scheme.",
    ),
    ColumnSpec(
        "manager_tenure_years",
        "Manager Tenure",
        "years",
        "Years since the current fund manager's stated start date, derived at query time.",
        "as of today",
        "as published",
        "context",
        "Third-party enrichment, not AMFI. Blank when the source does not carry a start date.",
    ),
)

NUMERIC_BY_NAME: Final[dict[str, ColumnSpec]] = {c.name: c for c in NUMERIC_COLUMNS}

TEXT_COLUMNS: Final[tuple[str, ...]] = (
    "scheme_code",
    "scheme_name",
    "amc",
    "clean_category",
    "clean_sub_category",
    "cap_band",
    "style",
    "clean_plan",
    "clean_option",
    "fund_family_id",
    "category",
    "sub_category",
    "plan",
    "option",
    "isin_growth",
    "isin_dividend",
    "benchmark_id",
    "data_quality_flags",
    "missing_reasons",
    "first_nav_date",
    "last_nav_date",
    "latest_nav_date",
    "aum_date",
    "aum_quarter",
    "is_active",
    "is_stale",
    "category_resolution",
    # T3.2 enrichment, joined from scheme_attributes - see the NUMERIC_COLUMNS comment above.
    "riskometer",
    "benchmark_name",
    "fund_manager",
)

COUNT_COLUMNS: Final[tuple[str, ...]] = (
    *(f"rolling_{h}y_window_count" for h in ROLLING_HORIZONS),
    *(f"{p}_{h}y" for h in HORIZONS for p in ("category_peer_count", "regression_obs")),
    "monthly_obs_count",
    "nav_gap_months",
)

SORTABLE: Final[frozenset[str]] = frozenset(
    [
        *NUMERIC_BY_NAME,
        *(f"rolling_{h}y_window_count" for h in ROLLING_HORIZONS),
        "scheme_name",
        "amc",
        "clean_sub_category",
        "cap_band",
        "style",
        "riskometer",
        "benchmark_name",
        "fund_manager",
    ]
)

SELECTABLE: Final[frozenset[str]] = frozenset(
    [
        *NUMERIC_BY_NAME,
        *TEXT_COLUMNS,
        *(f"rolling_{h}y_window_count" for h in ROLLING_HORIZONS),
        *(f"category_peer_count_{h}y" for h in HORIZONS),
        *(f"regression_obs_{h}y" for h in HORIZONS),
        "monthly_obs_count",
        "nav_gap_months",
        "as_of_date",
        "category_key",
        "methodology_version",
    ]
)

# The table pins its leading column so the fund stays readable while the metrics scroll
# sideways, and every row links and selects by code, so neither can be deselected and the
# name has to lead.
PINNED_COLUMNS: Final[tuple[str, ...]] = ("scheme_name", "scheme_code")

DEFAULT_COLUMNS: Final[tuple[str, ...]] = (
    *PINNED_COLUMNS,
    "amc",
    "clean_sub_category",
    "cap_band",
    "style",
    "clean_plan",
    "clean_option",
    "latest_aum",
    "fund_age_years",
    "expense_ratio",
    "cagr_1y",
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
    "downside_capture_5y",
    "alpha_5y",
    "beta_5y",
    "r_squared_5y",
    "benchmark_id",
    "data_quality_flags",
    "missing_reasons",
)
