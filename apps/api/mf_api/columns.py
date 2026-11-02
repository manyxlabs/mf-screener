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

# Buckets for grouping the catalog in the picker, the glossary and the methodology
# table. Closed set: the integration test rejects anything outside it.
Group = Literal[
    "Returns",
    "Rolling returns",
    "Vs similar funds",
    "Vs index",
    "Risk",
    "Drawdown",
    "Costs & terms",
    "Size",
    "Rank stability",
    "Fund basics",
]

# LANGUAGE GUARDRAILS for every `plain_label` and `plain_definition` below, and for
# every metric added after them.
#
# Banned words: "best", "top", "safe", "should", "recommended", "winner".
# No verb that instructs the reader. A plain label says what the number IS; it never
# says what to do about it. "Similar funds" stands in for "peers" and "sub-category"
# in plain text - the technical `label` and `definition` keep the precise term, and
# are never softened to match.
# `direction` stays as it is: "better: higher/lower" is a property of the metric, not
# advice about any fund.
# Nothing this project outputs is advice. That invariant outranks readability.


class ColumnSpec:
    __slots__ = (
        "caveat",
        "definition",
        "direction",
        "frequency",
        "group",
        "label",
        "name",
        "period",
        "plain_definition",
        "plain_label",
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
        *,
        plain_label: str = "",
        plain_definition: str = "",
        group: Group | str = "",
    ) -> None:
        self.name = name
        self.label = label
        self.unit = unit
        self.definition = definition
        self.period = period
        self.frequency = frequency
        self.direction = direction
        self.caveat = caveat
        self.plain_label = plain_label
        self.plain_definition = plain_definition
        self.group = group

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
        plain_label=f"Past return per year ({h}Y)",
        plain_definition=(
            f"What a lump sum put in {h} years ago grew by, averaged out to a per-year figure."
        ),
        group="Returns",
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
        plain_label=f"Past return per year, monthly SIP ({h}Y)",
        plain_definition=(
            f"What the same amount paid in every month for {h} years grew by, as a per-year figure."
        ),
        group="Returns",
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
        plain_label=f"Typical {h}-year outcome, monthly SIP",
        plain_definition=(
            f"The middle result across every {h}-year stretch in which someone paid in monthly, "
            "so the start month matters less."
        ),
        group="Rolling returns",
    )


def _rolling(
    h: int,
    stat: str,
    label: str,
    direction: Direction,
    caveat: str,
    *,
    plain_label: str,
    plain_definition: str,
) -> ColumnSpec:
    return ColumnSpec(
        f"rolling_{h}y_{stat}",
        f"Rolling {h}Y {label}",
        "percent",
        f"{label} of every overlapping {h}-year annualised return in the fund's history.",
        f"all {h}-year windows",
        "monthly",
        direction,
        caveat,
        plain_label=plain_label,
        plain_definition=plain_definition,
        group="Rolling returns",
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
                plain_label=f"Average {h}-year outcome",
                plain_definition=(
                    f"The per-year return averaged across every {h}-year stretch in the fund's history."
                ),
            ),
            _rolling(
                h,
                "median",
                "median",
                "higher_is_better",
                "Less sensitive to one exceptional market phase than the mean.",
                plain_label=f"Typical {h}-year outcome",
                plain_definition=(
                    f"The middle result across every {h}-year stretch, so one unusual period does "
                    "not pull it around."
                ),
            ),
            _rolling(
                h,
                "min",
                "minimum",
                "higher_is_better",
                "The single worst window in the available history - not a floor on future outcomes.",
                plain_label=f"Worst {h}-year stretch on record",
                plain_definition=(
                    f"The lowest per-year return of any {h}-year stretch the fund has lived through."
                ),
            ),
            _rolling(
                h,
                "max",
                "maximum",
                "context",
                "The best window. Useful for range, useless as an expectation.",
                plain_label=f"Strongest {h}-year stretch on record",
                plain_definition=(
                    f"The highest per-year return of any {h}-year stretch the fund has lived through."
                ),
            ),
            _rolling(
                h,
                "std",
                "dispersion",
                "lower_is_better",
                "Standard deviation across overlapping windows; windows share months, so it understates independence.",
                plain_label="How much the outcome depended on start date",
                plain_definition=(
                    f"How far apart the {h}-year results were, depending on the month someone "
                    "happened to start."
                ),
            ),
            _rolling(
                h,
                "positive_pct",
                "positive %",
                "higher_is_better",
                "Share of windows with a return above zero, not above inflation.",
                plain_label=f"How often {h} years ended in profit",
                plain_definition=(
                    f"The share of {h}-year stretches that finished above what was put in."
                ),
            ),
            _rolling(
                h,
                "beat_category_pct",
                "beat sub-category %",
                "higher_is_better",
                "Compared against the equal-weighted peer index, which is itself survivorship-affected.",
                plain_label="How often it beat similar funds",
                plain_definition=(
                    f"The share of {h}-year stretches in which it ended ahead of the average "
                    "similar fund."
                ),
            ),
            _rolling(
                h,
                "beat_benchmark_pct",
                "beat benchmark %",
                "higher_is_better",
                "Only as good as the mapped benchmark series.",
                plain_label="How often it beat its index",
                plain_definition=(
                    f"The share of {h}-year stretches in which it ended ahead of the index it is "
                    "measured against."
                ),
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
                plain_label="Share of similar funds' good months captured",
                plain_definition=(
                    "How much of the gain similar funds made in their rising months this fund made too."
                ),
                group="Vs similar funds",
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
                plain_label="Share of similar funds' bad months taken on",
                plain_definition=(
                    "How much of the loss similar funds took in their falling months this fund took too."
                ),
                group="Vs similar funds",
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
        plain_label="Time taken to recover that fall",
        plain_definition="How long it took to get back to the level it fell from.",
        group="Drawdown",
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
        plain_label="Worst full year it has had",
        plain_definition="The return in the poorest January-to-December year of its life so far.",
        group="Returns",
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
        plain_label="Which year was the worst full year",
        plain_definition="The calendar year in which that poorest full-year return happened.",
        group="Returns",
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
        plain_label="Share of years that ended up",
        plain_definition="Out of its full calendar years, how many finished higher than they started.",
        group="Returns",
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
        plain_label="How much its investing style has shifted (3Y)",
        plain_definition=(
            "How far the kind of holdings its returns look like has moved over the last three years."
        ),
        group="Rank stability",
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
        plain_label="Rank group among similar funds today, on 3-year return (1 = top quarter)",
        plain_definition=(
            "Which quarter of similar funds its three-year return sits in as of today."
        ),
        group="Rank stability",
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
        plain_label="Rank group among similar funds today (1 = top quarter)",
        plain_definition=(
            "Which quarter of similar funds its five-year return sits in as of today."
        ),
        group="Rank stability",
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
        plain_label="How often it stayed in the same rank group",
        plain_definition=(
            "Over the last few years, how much of the time it sat in the rank group it is in now."
        ),
        group="Rank stability",
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
        plain_label="Time spent in the top quarter of similar funds",
        plain_definition=(
            "How much of the last few years its three-year return ranked in the leading quarter "
            "of similar funds."
        ),
        group="Rank stability",
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
        plain_label="How often its rank group changed",
        plain_definition=(
            "The number of times it moved from one quarter of similar funds to another."
        ),
        group="Rank stability",
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
                plain_label=f"Ahead of / behind similar funds ({h}Y)",
                plain_definition=(
                    "How far its per-year return sits above or below the average similar fund."
                ),
                group="Vs similar funds",
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
                plain_label=f"Times the similar-fund average ({h}Y)",
                plain_definition=(
                    "Its per-year return expressed as a multiple of the average similar fund's."
                ),
                group="Vs similar funds",
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
                plain_label=f"Similar funds' average return ({h}Y)",
                plain_definition=(
                    "The per-year return of the average fund of the same type, this one left out."
                ),
                group="Vs similar funds",
            ),
            ColumnSpec(
                f"benchmark_return_{h}y",
                f"Benchmark CAGR {h}Y",
                "percent",
                "Trailing CAGR of the mapped benchmark over the same window as the fund.",
                f"{h} years",
                "monthly",
                "context",
                "Blank when no benchmark series is loaded for the fund's category.",
                plain_label=f"Its index's return ({h}Y)",
                plain_definition="The per-year return of the index this fund is measured against.",
                group="Vs index",
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
                plain_label=f"Ahead of / behind its index ({h}Y)",
                plain_definition=(
                    "How far its per-year return sits above or below the index it is measured against."
                ),
                group="Vs index",
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
                plain_label=f"How reliably it beat similar funds ({h}Y)",
                plain_definition=(
                    "Whether its lead over similar funds came steadily month after month or from "
                    "a few odd months."
                ),
                group="Vs similar funds",
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
                plain_label=f"How reliably it beat its index ({h}Y)",
                plain_definition=(
                    "Whether its lead over the index came steadily month after month or from a "
                    "few odd months."
                ),
                group="Vs index",
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
                plain_label=f"Return earned per unit of ups and downs ({h}Y)",
                plain_definition=(
                    "How much return it produced for the amount its value moved around."
                ),
                group="Risk",
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
                plain_label=f"Return earned per unit of downside ({h}Y)",
                plain_definition=(
                    "How much return it produced for the size of its losing months alone."
                ),
                group="Risk",
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
                plain_label=f"How bumpy the ride was ({h}Y)",
                plain_definition="How widely its month-to-month returns swung around their average.",
                group="Risk",
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
                plain_label=f"How large the bad months were ({h}Y)",
                plain_definition="How far its weak months fell short, ignoring the good ones.",
                group="Risk",
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
                plain_label=f"How closely it follows its index ({h}Y)",
                plain_definition="How far its month-to-month returns drift from the index's.",
                group="Vs index",
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
                plain_label=f"Return the index does not explain ({h}Y)",
                plain_definition=(
                    "The part of its return left over once the index's own movement is accounted for."
                ),
                group="Vs index",
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
                plain_label=f"How hard it swings with the index ({h}Y)",
                plain_definition=(
                    "Whether it moves more or less than the index when the index moves."
                ),
                group="Vs index",
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
                plain_label=f"How much the index explains ({h}Y)",
                plain_definition=(
                    "How much of its movement is simply the index moving, rather than anything "
                    "particular to this fund."
                ),
                group="Vs index",
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
                plain_label=f"Strength of the evidence behind that leftover return ({h}Y)",
                plain_definition=(
                    "How large the unexplained return is next to the noise in the same measurement."
                ),
                group="Vs index",
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
                plain_label=f"Odds this outperformance is chance ({h}Y)",
                plain_definition=(
                    "How often a fund with no real edge would show a gap this large by luck alone."
                ),
                group="Vs index",
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
                plain_label=f"Worst fall from a peak ({h}Y)",
                plain_definition=(
                    "The largest drop from a high point to the low that followed it, before any recovery."
                ),
                group="Drawdown",
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
                plain_label=f"Return per unit of worst fall ({h}Y)",
                plain_definition=(
                    "Its per-year return set against the deepest drop it went through to get there."
                ),
                group="Drawdown",
            ),
        )
    ),
    ColumnSpec(
        "score",
        "Composite score",
        "score",
        "Weighted percentile decomposition against the fund's own peer group, 0-100. "
        "Computed by the same scoring module GET /score/{scheme_code} returns in full.",
        "3y / 5y / 10y blend",
        "monthly",
        "higher_is_better",
        "A description of the past against a declared weight table, never a rating or a "
        "recommendation. It is a percentile inside one peer group, so it does not compare "
        "across groups: a fund scoring 80 among 34 small-cap funds and one scoring 60 among "
        "16 US feeders are not ranked against each other. Blank where the peer group is too "
        "thin to rank in, or where the fund answers less than half the weight table.",
        plain_label="Score against similar funds",
        plain_definition=(
            "A 0-100 summary of how this fund compares with similar funds on the measures "
            "in the weight table. It compares like with like, so scores from two different "
            "groups of funds do not line up with each other."
        ),
        group="Vs similar funds",
    ),
    ColumnSpec(
        "score_coverage",
        "Score coverage",
        "percent",
        "Share of the composite score's weight table this fund could answer; the score is "
        "renormalised over it.",
        "as of the snapshot",
        "monthly",
        "context",
        "A young fund answers less of the table, so its score rests on fewer measures. Below "
        "half the table no score is published at all.",
        plain_label="How much of the score this fund could answer",
        plain_definition=(
            "How much of the scoring table this fund has enough history for. A lower figure "
            "means the score rests on fewer measures."
        ),
        group="Vs similar funds",
    ),
    ColumnSpec(
        "momentum_12_1",
        "Momentum 12-1",
        "percent",
        "Total return over the eleven months ending one month before the snapshot date.",
        "months -12 to -1",
        "monthly",
        "higher_is_better",
        "The most recent month is deliberately left out: it carries a short-term reversal "
        "that says nothing about the manager. Blank below eleven months of history.",
        plain_label="Recent run, last year minus last month",
        plain_definition=(
            "How much the fund gained over the last year, ignoring the most recent month."
        ),
        group="Returns",
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
        plain_label="Annual fee, already deducted from returns",
        plain_definition=(
            "The yearly charge the fund house takes; the returns shown are after it."
        ),
        group="Costs & terms",
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
        plain_label="How long this fund has existed",
        plain_definition="Years between its first published price and its latest one.",
        group="Fund basics",
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
        plain_label="Money in this exact plan (quarterly average)",
        plain_definition=(
            "How much investors hold in this one plan variant, averaged over the latest quarter."
        ),
        group="Size",
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
        plain_label="Total money in the fund, all plans",
        plain_definition="How much investors hold in this fund across every plan variant of it.",
        group="Size",
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
        plain_label="Change in fund size over a year",
        plain_definition="How much the money held in the fund grew or shrank over the last four quarters.",
        group="Size",
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
        plain_label="Size compared with similar funds",
        plain_definition="Where its size sits in the line-up of funds of the same type.",
        group="Size",
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
        plain_label="Price of one unit today",
        plain_definition=(
            "What one unit of the fund is worth now; a high or low figure says nothing about "
            "how the fund has done."
        ),
        group="Fund basics",
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
        plain_label="Charge for selling early",
        plain_definition="What is deducted if the money is taken out inside the early-exit window.",
        group="Costs & terms",
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
        plain_label="How long that early-exit charge applies",
        plain_definition="The number of days after buying during which selling incurs the charge.",
        group="Costs & terms",
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
        plain_label="Money cannot be withdrawn for",
        plain_definition="The period after buying in which the money simply cannot be taken out.",
        group="Costs & terms",
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
        plain_label="Smallest lump sum",
        plain_definition="The least the fund accepts as a one-off amount.",
        group="Costs & terms",
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
        plain_label="Smallest monthly amount",
        plain_definition="The least the fund accepts as a monthly instalment.",
        group="Costs & terms",
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
        plain_label="Years the current manager has run it",
        plain_definition=(
            "How long the person deciding what the fund holds has been in that seat; the record "
            "above may predate them."
        ),
        group="Fund basics",
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

# The first view a newcomer sees: one headline return, an honesty check on it (typical
# and worst window), one downside number, one peer-relative number, one cost number.
# `missing_reasons` is never rendered - it is what every blank cell's tooltip reads.
STARTER_COLUMNS: Final[tuple[str, ...]] = (
    *PINNED_COLUMNS,
    "clean_sub_category",
    "fund_age_years",
    "cagr_5y",
    "rolling_5y_median",
    "rolling_5y_min",
    "max_drawdown_5y",
    "fund_minus_category_5y",
    "expense_ratio",
    "missing_reasons",
)

# The "Standard" set: the composite score, then every metric it reads, at the horizons
# it reads them - so a screen can be checked against the score that ranks it, column
# by column, rather than having to take the number on trust.
# Each family runs 3/5/10 years - a fund that beat its peers over three years and lost
# to them over ten is the case this set exists to make visible. `missing_reasons` is
# never rendered; it is what every blank cell's tooltip reads.
DEFAULT_COLUMNS: Final[tuple[str, ...]] = (
    *PINNED_COLUMNS,
    # First after the fund's own identity: the rest of this set is the decomposition
    # behind it, so it reads as the summary and then the workings.
    "score",
    "score_coverage",
    "amc",
    "clean_sub_category",
    "cap_band",
    "style",
    "clean_plan",
    "clean_option",
    "latest_aum",
    "fund_age_years",
    "expense_ratio",
    "cagr_3y",
    "cagr_5y",
    "cagr_10y",
    "fund_minus_category_3y",
    "fund_minus_category_5y",
    "fund_minus_category_10y",
    "rolling_3y_median",
    "rolling_5y_median",
    "rolling_10y_median",
    "sharpe_3y",
    "sharpe_5y",
    "sharpe_10y",
    "sortino_3y",
    "sortino_5y",
    "sortino_10y",
    "volatility_3y",
    "volatility_5y",
    "volatility_10y",
    "alpha_3y",
    "alpha_5y",
    "alpha_10y",
    # Alpha read without the fit it came out of is a half-truth: a large alpha off a
    # low R-squared regression is noise, so both travel with it.
    "beta_5y",
    "r_squared_5y",
    "information_ratio_vs_category_5y",
    "information_ratio_vs_benchmark_5y",
    "max_drawdown_5y",
    "benchmark_id",
    "data_quality_flags",
    "missing_reasons",
)
