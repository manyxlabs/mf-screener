"""Machine-readable methodology, served to the UI and rendered on /methodology."""

from __future__ import annotations

from typing import Any

from mf_analytics.config import BASE_CURRENCY, Settings
from mf_analytics.metrics.basket import MIN_OBS as BASKET_MIN_OBS
from mf_analytics.metrics.cashflow import MIN_SIP_CONTRIBUTIONS
from mf_analytics.metrics.exposure import MIN_DRIFT_WINDOWS, ROLLING_WINDOW_MONTHS
from mf_analytics.metrics.exposure import MIN_MONTHS_DEFAULT as EXPOSURE_MIN_MONTHS
from mf_analytics.metrics.exposure import MIN_R_SQUARED_DEFAULT as EXPOSURE_MIN_R_SQUARED
from mf_analytics.metrics.persistence import PERSISTENCE_WINDOW_YEARS
from mf_analytics.pipeline import (
    AUM_GROWTH_LOOKBACK_QUARTERS,
    INSUFFICIENT_AUM_HISTORY,
    MIN_CALENDAR_YEARS,
)
from mf_analytics.quality import all_reason_descriptions
from mf_analytics.scoring import (
    COMPONENT_WEIGHTS,
    COMPONENTS,
    HORIZON_WEIGHTS,
    HORIZONS,
    MIN_COVERAGE,
)
from mf_analytics.universe import DEFAULT_UNIVERSE

from .columns import NUMERIC_COLUMNS


def methodology_document(settings: Settings) -> dict[str, Any]:
    rf_monthly = settings.risk_free_monthly
    return {
        "version": settings.mf_methodology_version,
        "disclaimer": (
            "This is a research and analytics tool, not investment advice. Historical "
            "returns do not guarantee future returns."
        ),
        "frequency": {
            "returns_risk_and_peer_metrics": "month-end NAV and monthly returns",
            "maximum_drawdown": "daily NAV",
            "charts_and_nav_history": "daily NAV",
            "annualisation_monthly": "sqrt(12)",
            "why_month_end": (
                "Comparing a fund with its peers or a benchmark requires every series on "
                "the same dates. Funds publish on different days and index data often "
                "arrives month-end only, so aligning on daily NAV would mean either "
                "discarding the days that do not match everywhere or filling the gaps, "
                "and gaps are never filled here."
            ),
            "why_drawdown_is_daily": (
                "Drawdown measures the path rather than the endpoints, so a month-end "
                "sample steps over the trough. Through the 2020 crash a month-end grid "
                "put a typical equity fund at -23% against -34% on daily NAV. It needs no "
                "cross-series alignment, so it is the one metric that can use daily data "
                "without costing comparability."
            ),
        },
        "risk_free_rate": {
            "annual": settings.mf_risk_free_annual,
            "monthly": rf_monthly,
            "conversion": "(1 + annual) ** (1/12) - 1",
            "configurable_via": "MF_RISK_FREE_ANNUAL in .env",
        },
        "month_end_rule": (
            "The last NAV published in a calendar month is that month's observation, but "
            f"only if it falls within {settings.mf_month_end_tolerance_days} days of the month "
            "end. That excludes the running current month and any month where publication "
            "stopped early. Missing months stay missing: NAV is never forward-filled."
        ),
        "formulas": {
            "trailing_cagr": r"\mathrm{CAGR}_h = \left(\frac{NAV_T}{NAV_{T-h}}\right)^{1/h} - 1",
            "rolling_cagr": r"r_h(t) = \left(\frac{NAV_t}{NAV_{t-12h}}\right)^{1/h} - 1",
            "sharpe": r"\mathrm{Sharpe} = \frac{\overline{R_f - R_{rf}}}{\sigma(R_f)}\sqrt{12}",
            "sortino": r"\mathrm{Sortino} = \frac{\overline{R_f - R_{rf}}}{\sigma_{down}}\sqrt{12}",
            "downside_deviation": r"\sigma_{down} = \sqrt{\frac{\sum_{R_f < R_{rf}} (R_f - R_{rf})^2}{n - 1}}\sqrt{12}",
            "volatility": r"\sigma_{ann} = \sigma(R_f,\ ddof{=}1)\sqrt{12}",
            "tracking_error": r"\mathrm{TE} = \sigma(R_f - R_b,\ ddof{=}1)\sqrt{12}",
            "information_ratio": r"\mathrm{IR} = \frac{\overline{A}}{\sigma(A,\ ddof{=}1)}\sqrt{12},\quad A_t = R_{f,t} - R_{c,t}",
            "alpha_beta": r"R_f - R_{rf} = \alpha_m + \beta (R_b - R_{rf}) + \varepsilon,\quad \alpha = (1+\alpha_m)^{12} - 1",
            "alpha_tstat": r"t = \frac{\alpha_m}{\mathrm{se}(\alpha_m)},\quad \mathrm{se}(\alpha_m) = \sqrt{\hat\sigma^2 \left(\frac{1}{n} + \frac{\bar{x}^2}{S_{xx}}\right)},\quad \hat\sigma^2 = \frac{\sum \varepsilon^2}{n-2}",
            "alpha_pvalue": r"p = \Pr(|T| > |t|),\quad T \sim t_{n-2}",
            "max_drawdown": r"\mathrm{MDD} = \min_t \left(\frac{NAV_t}{\max_{s \le t} NAV_s} - 1\right)",
            "calmar": r"\mathrm{Calmar} = \frac{\mathrm{CAGR}_h}{|\mathrm{MDD}_h|}",
            "peer_excess": r"\text{excess} = \mathrm{CAGR}_{fund} - \overline{\mathrm{CAGR}}_{peers \setminus fund}",
            "peer_ratio": r"\text{ratio} = \frac{\mathrm{CAGR}_{fund}}{\overline{\mathrm{CAGR}}_{peers \setminus fund}}",
            "sip_xirr": r"0 = \sum_i \frac{CF_i}{(1+\mathrm{XIRR})^{d_i/365}}",
            "basket_correlation": r"\rho_{i,j} = \mathrm{corr}(R_i, R_j)\ \text{over matched months}",
            "basket_blended_return": r"R_{blend,t} = \sum_i w_i R_{i,t}",
            "diversification_benefit": r"\sum_i w_i \sigma_{ann,i} - \sigma_{ann,blend}",
            "capture_ratio": (
                r"\mathrm{Capture} = \frac{\prod_{t \in S}(1+R_{f,t}) - 1}"
                r"{\prod_{t \in S}(1+R_{c,t}) - 1},\quad S = \{t : R_{c,t} \gtrless 0\}"
            ),
            "worst_calendar_year_return": r"\min_y \prod_{t \in y}(1+R_{f,t}) - 1",
            "quartile_now": (
                r"\mathrm{quartile}(t) = \mathrm{ntile}_4\big(\mathrm{rank}(\mathrm{rolling\_cagr}_h(t)) "
                r"\text{ within sub-category at } t\big)"
            ),
            "quartile_persistence_3y": (
                r"\frac{1}{|W|}\sum_{t \in W} \mathbb{1}[\mathrm{quartile}(t) = \mathrm{quartile}(now)],"
                r"\quad W = \{t : now - 5y < t \le now\}"
            ),
            "style_exposure": (
                r"\min_w \sum_t (R_{f,t} - w^\top R_{b,t})^2 \quad\text{s.t. } w \ge 0,\ "
                r"\textstyle\sum w = 1"
            ),
            "style_drift_3y": (
                r"\frac{1}{|W|-1}\sum_{i=1}^{|W|-1} \tfrac{1}{2}\sum_b |w_i(b) - w_{i-1}(b)|,"
                r"\quad W = \text{fitted 36-month windows ending in the last 3 years}"
            ),
            "aum_family_latest": r"\mathrm{AUM}_{family} = \sum_{c \in family} \mathrm{AUM}_c",
            "aum_growth_4q": (r"\frac{\mathrm{AUM}_{family}(t)}{\mathrm{AUM}_{family}(t-4q)} - 1"),
            "aum_percentile_in_sub_category": (
                r"\mathrm{ntile}\big(\mathrm{rank}(\mathrm{AUM}_{family}) "
                r"\text{ within sub-category}\big),\ 1.0 = \text{largest}"
            ),
        },
        "formula_notes": {
            "trailing_cagr": (
                "NAV_T is the latest month-end NAV; NAV_{T-h} is the observation h years "
                f"earlier, accepted only within {settings.mf_month_end_tolerance_days} days "
                "of that month end."
            ),
            "downside_deviation": (
                "Only months below the risk-free rate contribute to the sum, but n is the "
                "full sample, which keeps this on the same scale as volatility."
            ),
            "sharpe": "The denominator is total volatility, so upside variation is penalised too.",
            "information_ratio": (
                "R_c is the comparison return: the leave-one-out peer average, or the mapped "
                "benchmark, depending on which information ratio is shown."
            ),
            "alpha_beta": "Ordinary least squares on monthly excess returns; R-squared is reported alongside.",
            "alpha_tstat": (
                "Tests the monthly intercept alpha_m against zero, from the same OLS fit as "
                "alpha_beta; x_bar and S_xx are the mean and sum of squared deviations of the "
                "benchmark's monthly excess return. The t-statistic is on the monthly estimate, "
                "not the annualised alpha shown elsewhere, because annualising first would test "
                "a nonlinear transform of the estimate rather than the estimate itself. Null "
                "with reason 'zero_or_invalid_denominator' when the fit leaves no residual "
                "variance to estimate a standard error from."
            ),
            "alpha_pvalue": (
                "Two-sided p-value of alpha_tstat against a Student's t distribution with n-2 "
                "degrees of freedom. See 'alpha_significance' below before filtering on this: "
                "screened across thousands of funds, this number is not corrected for multiple "
                "comparisons."
            ),
            "peer_ratio": "Reported only when the peer average is positive; otherwise the excess is shown alone.",
            "max_drawdown": "Computed on daily NAV, so an intra-month trough is captured. The series starts at any NAV redenomination, so the step itself is never counted as a fall.",
            "sip_xirr": (
                "CF_i is -1 (one unit bought) at every month-end NAV in the window and the "
                "redemption value of the whole holding at the window's last month-end; d_i is "
                "actual calendar days since the first contribution, the same convention a "
                "spreadsheet's XIRR function uses. Solved with a bracketed root finder "
                "(Brent's method or an equivalent bisection), never a Newton guess, so a "
                "cash-flow series with no root in the bracket reports a named reason instead "
                "of a plausible wrong rate."
            ),
            "diversification_benefit": (
                "The weighted average of each component's own annualised volatility, minus "
                "the blend's own annualised volatility - the reduction in risk diversification "
                "bought by holding several funds rather than the single riskiest one at the "
                "same total weight. It is zero when every component moves in lockstep "
                "(correlation 1) and positive whenever they do not, whatever the correlation. "
                "Correlation of returns is not portfolio overlap: two funds with entirely "
                "different holdings can still be highly correlated, and two funds with "
                "overlapping holdings can still show a low correlation."
            ),
            "capture_ratio": (
                "R_c is the leave-one-out sub-category peer average, the same comparison "
                "series the information ratio vs sub-category uses - never a benchmark. "
                "The up set is months the peer average rose, the down set months it fell; "
                "each ratio compounds the fund's return and the peer return separately "
                "over that set before dividing, rather than averaging a ratio month by "
                "month, so a single very negative month cannot dominate the result."
            ),
            "worst_calendar_year_return": (
                f"Only complete (12-month) calendar years count, at least {MIN_CALENDAR_YEARS} "
                "of them; a fund's first and last year are almost always partial and are "
                "excluded rather than compared against a full year. "
                "'positive_calendar_years_pct' is the share of those same complete years "
                "with a positive return."
            ),
            "max_drawdown_5y_recovery_days": (
                "Calendar days from the trough of the worst peak-to-trough fall in the "
                "last 5 years to the first daily NAV that regained the pre-fall peak. Null "
                "with reason 'not_recovered', never a large number, when that peak has not "
                "yet been regained."
            ),
            "quartile_now": (
                "The fund's sub-category peers are ranked by trailing return at every "
                "month end (the same rolling series 'rolling_{h}y_median' summarises) and "
                "split into four equal-sized groups, 1 being the best-performing group. "
                "Computed at both 3y and 5y."
            ),
            "quartile_persistence_3y": (
                f"Read off the fund's trailing 3-year quartile at every eligible month end "
                f"in the last {PERSISTENCE_WINDOW_YEARS} years: the share matching the "
                "quartile it is in now is 'quartile_persistence_3y', the share in the top "
                "quartile is 'quartile_top_share_3y', and the count of month-to-month "
                "quartile changes is 'quartile_transitions_3y'. Past performance chasing "
                "is the error this exists to check."
            ),
            "style_exposure": (
                "R_b is the whole style-factor basis at once: every non-negative weight "
                "summing to one, chosen to minimise squared error against the fund's own "
                "monthly returns. Weights below 0.01% are dropped rather than shown as a "
                "false-precision exposure. Describes behaviour only - never read as a "
                "holdings statement."
            ),
            "style_drift_3y": (
                "The single style_exposure fit repeated on every trailing 36-month window, "
                "stepped one month at a time, restricted to windows ending in the last 3 "
                "years. w_i(b) is the fitted weight on basis member b in window i; the mean "
                "is over each pair of consecutive windows that both clear the R-squared "
                "floor, so a window that fails the fit is dropped from the series with its "
                "reason rather than carrying the previous window's weights forward, and "
                "never bridged across in the drift calculation either."
            ),
            "aum_family_latest": (
                "AUM_c is latest_aum for one scheme code; the family sums every code "
                "sharing this fund's fund_family_id (T2.1), so a Direct/Regular or "
                "Growth/IDCW split is not undercounted as several small funds."
            ),
            "aum_growth_4q": (
                "aum_family_latest at the two AMFI-published quarters 4 apart, read "
                "from scheme_aum_history rather than parsed from the aum_quarter label."
            ),
            "aum_percentile_in_sub_category": (
                "Percentile rank of aum_family_latest among peers in the fund's "
                "clean_sub_category, 1.0 being the largest fund by family AUM. A column "
                "to read beside the score rather than one of its components: asset "
                "bloat is a risk to weigh yourself, not one this score prices."
            ),
        },
        "score": {
            "description": (
                "A weighted, within-peer-group percentile decomposition, never a rating "
                "or a recommendation. Every component is a percentile against the fund's "
                "own peer_group - its sub-category refined by what it actually holds, "
                "because SEBI files by legal wrapper and would otherwise rank a Nasdaq "
                "feeder against gold funds - and GET /score/{scheme_code} returns the "
                "percentile and point contribution of each one alongside the total."
            ),
            "weights": COMPONENT_WEIGHTS,
            "horizon_weights": HORIZON_WEIGHTS,
            "components": {
                name: {
                    "metrics": [
                        metric.column
                        for horizon in (("3y",) if component.horizon_free else HORIZONS)
                        for metric in component.columns(horizon)
                    ],
                    "combination": (
                        "one reading, scored once - this metric has no 3/5/10-year family"
                        if component.horizon_free
                        else "the 3/5/10-year readings blended on horizon_weights, each "
                        "horizon read through the first metric listed that has a value"
                    ),
                    "weight": COMPONENT_WEIGHTS[name],
                    "description": component.description,
                }
                for name, component in COMPONENTS.items()
            },
            "not_double_counted": (
                "Raw CAGR carries no weight of its own: measured on the live universe it "
                "ranks funds identically to fund_minus_category inside a sub-category "
                "(Spearman 1.000), so counting both would be counting returns twice. "
                "Sortino likewise only stands in for a null Sharpe (0.990). AUM carries no "
                "weight here at all - it is a column to read beside the score, not part "
                "of it."
            ),
            "missing_component_handling": (
                "A fund missing a component is scored on the components it has: the "
                "missing ones are named, their contribution is null rather than zero or a "
                "category average, and both the horizon blend and the total renormalise "
                "over the weight actually present, so a fund with no ten-year column is "
                "not ranked below one that merely has more history. `coverage` reports "
                f"the share of the weight table the fund answered; below {MIN_COVERAGE:.0%} "
                "no total is published at all and only the components are shown."
            ),
            "minimum_peers": (
                f"{settings.mf_min_peers} eligible peers with a non-null value for that "
                "component's underlying metric (MF_MIN_PEERS), the same floor every other "
                "peer-relative metric in this document uses."
            ),
        },
        "peer_universe_default": DEFAULT_UNIVERSE.model_dump(),
        "peer_universe_rules": [
            "Direct plans only and Growth option only by default; plans and options are never mixed silently.",
            "Active schemes only by default, which introduces survivorship bias in historical screening.",
            f"At least {settings.mf_min_peers} eligible peers, otherwise the metric is null with reason "
            "'insufficient_peer_universe'.",
            "Peer averages exclude the fund being measured (leave-one-out); at least 2 peers must remain.",
            "A ratio against a zero or negative peer return is reported as null; the percentage-point "
            "excess is still shown.",
        ],
        "minimum_observations": {
            "rolling_1y_point": "12 months",
            "rolling_3y_point": "36 months",
            "rolling_5y_point": "60 months",
            "rolling_10y_point": "120 months",
            "rolling_summary": f"{settings.mf_min_rolling_windows} valid windows (MF_MIN_ROLLING_WINDOWS)",
            "sip_xirr": f"{MIN_SIP_CONTRIBUTIONS} monthly contributions in the window",
            "rolling_sip_xirr_median": (
                f"{settings.mf_min_rolling_windows} valid windows (MF_MIN_ROLLING_WINDOWS), "
                f"each itself requiring {MIN_SIP_CONTRIBUTIONS} contributions"
            ),
            "risk_metrics": {"3y": 24, "5y": 42, "10y": 84},
            "alpha_significance": (
                "Same floor as the risk metrics at that horizon, since alpha_tstat and "
                "alpha_pvalue come from the same regression as alpha and beta."
            ),
            "capture_ratios": "Same floor as the risk metrics at that horizon: 24 months at 3y, 42 at 5y.",
            "calendar_year_summary": f"{MIN_CALENDAR_YEARS} complete (12-month) calendar years",
            "quartile_ranking": (
                f"{settings.mf_min_peers} eligible peers in the sub-category at that month end "
                "(MF_MIN_PEERS), the same floor every other peer-relative metric uses; below it "
                "the month end is excluded rather than ranked on a thin universe."
            ),
            "basket_analysis": (
                f"{BASKET_MIN_OBS} matched monthly observations across every basket member, "
                "the same 3-year floor the risk metrics use; below it the whole /basket "
                "response is null with reason 'insufficient_history'."
            ),
            "style_exposure": (
                f"{EXPOSURE_MIN_MONTHS} months shared with every member of the style-factor "
                f"basis, and a fit explaining at least {EXPOSURE_MIN_R_SQUARED:.0%} of the "
                "fund's month-to-month movement (R-squared); below either, null with reason "
                "'insufficient_observations' or 'style_basis_does_not_describe_this_fund'."
            ),
            "style_drift_3y": (
                f"Each window needs {ROLLING_WINDOW_MONTHS} months and the same R-squared "
                f"floor as style_exposure; the scalar itself needs at least "
                f"{MIN_DRIFT_WINDOWS} such windows ending in the last 3 years, otherwise "
                "null with reason 'insufficient_rolling_windows'."
            ),
            "why_risk_metrics_start_at_3y": (
                "Rolling windows go down to one year because a 1-year window still yields a long "
                "series of overlapping observations. The peer-relative, benchmark-relative and "
                "risk metrics do not: a 1-year window holds about 10 matched monthly "
                "observations, too thin a sample for a beta, a Sharpe or a tracking error that a "
                "screener will sort on."
            ),
            "aum_growth_4q": (
                f"{AUM_GROWTH_LOOKBACK_QUARTERS + 1} distinct dated readings in "
                "scheme_aum_history (the horizon plus the one to grow from); below "
                f"that, null with reason '{INSUFFICIENT_AUM_HISTORY}'."
            ),
            "aum_percentile_in_sub_category": (
                f"{settings.mf_min_peers} eligible peers in the sub-category with a "
                "computed aum_family_latest (MF_MIN_PEERS), the same floor every other "
                "peer-relative metric uses; below it, null with reason "
                "'insufficient_peer_universe'."
            ),
        },
        "benchmarks": {
            "policy": (
                "This project ships no index data. Import your own total-return index CSVs, or "
                "build a clearly-labelled proxy from an index fund's NAV. A proxy is net of that "
                "fund's expenses and tracking error, so it understates the index."
            ),
            "currency_rule": (
                f"Fund NAVs are published in {BASE_CURRENCY}. A benchmark in any other currency "
                "is stored and displayed, but no benchmark-relative metric is computed against "
                "it: alpha, beta, tracking error, the benchmark information ratio and the "
                "benchmark excess return all stay null with reason 'benchmark_currency_mismatch'. "
                "This project performs no FX conversion, and the import refuses a CSV with no "
                f"currency column rather than assuming {BASE_CURRENCY}. Where both an "
                f"{BASE_CURRENCY} and a foreign series are configured for the same category, the "
                f"{BASE_CURRENCY} one is always chosen."
            ),
            "csv_contract": (
                "date, benchmark_id, benchmark_name, currency and one of total_return_index or "
                "price. A total-return index is preferred: a growth-option NAV reinvests "
                "dividends, so a price index understates the benchmark and flatters the fund. "
                "Files are rejected whole, never partially imported."
            ),
        },
        "alpha_significance": {
            "problem": (
                "Alpha reported without a standard error, screened across the full universe, is "
                "a multiple-comparisons machine: some funds clear any p-value threshold by chance "
                "alone, with no skill behind the number."
            ),
            "no_correction_applied": (
                "No multiple-comparisons correction (Bonferroni, Benjamini-Hochberg or otherwise) "
                "is applied anywhere in this project. The raw, uncorrected p-value is what is "
                "stored and filtered on; this section exists so the user sees the consequence "
                "of that choice instead of it being silent."
            ),
            "expected_false_positives_at_p05": (
                "At the p < 0.05 threshold, about 5% of funds are expected to show a nominally "
                "significant alpha by chance alone even if none of them have true skill. Across "
                "the roughly 36,917 schemes in the metrics snapshot, that is on the order of "
                "1,846 funds - a number worth holding in mind before treating a low p-value on "
                "its own as evidence of skill."
            ),
            "how_to_read_it": (
                "Alpha p-value is a filter for ruling funds out, not for ruling one in: a high "
                "p-value says the alpha estimate is indistinguishable from noise, but a low one "
                "is necessary, not sufficient, evidence of skill. Cross-check with R-squared "
                "(is the benchmark actually a good fit?) and with the same fund's alpha at "
                "another horizon before treating a single significant result as a finding."
            ),
        },
        "data_quality_reasons": all_reason_descriptions(),
        "metric_catalog": [c.as_dict() for c in NUMERIC_COLUMNS],
        "sources": {
            "nav_original": "AMFI (Association of Mutual Funds in India), public records",
            "nav_delivery": "TigZig MF NAV API (api.tigzig.com/mf/v1)",
            "expense_ratio": (
                "AMFI's daily per-AMC TER disclosures (amfiindia.com/ter-of-mf-schemes), "
                "latest day per scheme; matched to schemes by name."
            ),
            "scheme_attributes": (
                "Riskometer, exit load, lock-in, minimum investment/SIP, SID benchmark and fund "
                "manager: a third-party candidate source, observed unreachable on first contact "
                "and not yet confirmed reliable. Never used in a return, risk or ranking - a "
                "screener filter or display value only, blank with a named reason wherever the "
                "source could not be reached or does not carry the fact."
            ),
            "attribution_note": (
                "TigZig reformats and republishes AMFI data; it is not an authoritative source "
                "and is not affiliated with AMFI."
            ),
        },
        "limitations": [
            "Expense ratio comes from a separate scrape of AMFI's per-AMC TER disclosures, "
            "not from the NAV source. It is joined by exact fund name, covers part of the "
            "industry rather than all of it, and is blank wherever a fund was not "
            "published under a matching name or its disclosure contradicted itself.",
            "AUM is AMFI's quarterly average per scheme code, not month-end AUM for the whole fund.",
            "Scheme mergers and renames can split one economic fund across scheme codes.",
            "SEBI re-categorisation means a fund's sub-category today may not be the one it ran under.",
            "The default active-only universe excludes closed and merged schemes, biasing history upward.",
            "Riskometer, exit load, lock-in, minimums, SID benchmark and fund manager come from an "
            "unproven third-party source and are never a return, risk or ranking input; manager "
            "tenure is computed from the manager's start date at query time, never stored.",
        ],
    }
