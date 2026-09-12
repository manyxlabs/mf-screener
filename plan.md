# mf-screener: plan to become a research, shortlisting and analysis platform

Status: proposed, 2026-09-09.
Owner: the repo maintainer.
Audience: coding agents working one task at a time.

This plan turns `mf-screener` from a returns-and-risk engine into an all-in-one mutual fund research, shortlisting and analysis platform.
It is written to be executed task by task, in order, by agents that have not read the codebase before.

## How to use this plan

Each task below has an ID, the files it touches, what to build, and an acceptance test.
Do one task per branch or per session.
Do not start a task in a later phase before every task in the earlier phase is merged and green.

Before writing any code for a task:

1. Read `README.md`, `docs/data-policy.md` and `docs/data-model.md`.
2. Search the codebase for the concept you are about to add, not for the name you were going to give it.
   Several things this plan calls "missing" already exist in `packages/analytics/src/mf_analytics/metrics/` and are simply not wired into the snapshot.
3. Run `make test` and `make lint` before you start, so you know what was already failing.

After finishing a task:

1. `make lint && make test` must pass.
2. Update `README.md` and the relevant file in `docs/` in the same change.
3. If the task adds a metric, add it to `/methodology` and to `apps/api/mf_api/methodology.py`, with its formula and its minimum observation count.

## Invariants that must not be broken

These are the properties that make this project worth more than the free screeners.
A change that violates one of them is wrong even if it passes the tests.

1. **A metric is never invented.**
   Below its minimum observation count it is null with a named reason, and the UI explains that reason wherever the dash appears.
2. **NAV from AMFI, via the configured provider, is the only source that returns and risk metrics are computed from.**
   Everything added by this plan is either derived from that NAV or is enrichment that never enters a return, a risk metric or a ranking.
3. **No scraping of AMC sites, no browser automation to collect investment data, no paid data API.**
   See `docs/data-policy.md`.
4. **Currency and benchmark discipline stays.**
   No FX conversion, and a benchmark that is not in INR yields null benchmark-relative metrics with `benchmark_currency_mismatch`.
5. **Bulk data never enters pandas.**
   Anything that touches the full NAV lake runs as DuckDB SQL over the partitioned Parquet.
6. **The frontend never reads data files.**
   It calls the API, and the API reads whitelisted columns through parameterised SQL.
7. **Nothing produced here is advice.**
   Scores and shortlists are described as descriptions of the past, with the methodology stated.

## What already exists, so you do not rebuild it

Verified in the code on 2026-09-09.

- 38,203 schemes in `scheme_master`, 36,917 rows in `scheme_metrics_snapshot`, 37M+ daily NAV rows in the year-partitioned lake.
- Trailing and rolling CAGR at 1, 3, 5 and 10 years, with per-window persistence in `rolling_returns_monthly`.
- Sharpe, Sortino, volatility, downside deviation, tracking error, information ratio against both peers and benchmark, alpha, beta, R-squared, Calmar, and maximum drawdown computed on daily NAV.
- Leave-one-out peer comparison inside `clean_sub_category`, with an eligible-peer floor.
- Returns-based style exposure in `metrics/exposure.py`, fitted against a seven-series basis, refused below an R-squared floor.
- `capture_ratios`, `drawdown_episodes` and `calendar_year_returns` already exist in `metrics/risk.py` and `metrics/series.py`.
  They are computed live by `GET /schemes/{code}/behaviour` and are **not** in the snapshot, so they cannot be screened, sorted or exported.
  Phase 1 fixes that rather than reimplementing them.
- Benchmark import, validation, mapping and index-fund proxies, with three distinct missing-benchmark reasons.
- Expense ratio joined by normalised name from a separate source, covering roughly 44% of active schemes and 14 of 52 AMCs.

## What is missing, in one list

| #   | Gap                                                                             | Phase |
| --- | ------------------------------------------------------------------------------- | ----- |
| 1   | SIP XIRR: the return an investor actually experienced                           | 1     |
| 2   | After-tax and after-exit-load returns                                           | 1     |
| 3   | Capture ratios, drawdown recovery, calendar years are live-only, not screenable | 1     |
| 4   | No quartile persistence: does a top fund stay a top fund                        | 1     |
| 5   | No rolling style exposure, so no style drift                                    | 1     |
| 6   | No fund-to-fund correlation or basket analysis                                  | 1     |
| 7   | Alpha reported without a t-statistic, screened across 36,917 schemes            | 1     |
| 8   | No composite score, so "shortlisting" is five preset filters                    | 1     |
| 9   | Plan and option variants of one fund are separate rows, inflating every count   | 2     |
| 10  | Category is a single current value, and SEBI re-categorisation is in flight     | 2     |
| 11  | AUM is a single quarterly figure with no history, so asset bloat is invisible   | 2     |
| 12  | Survivorship bias is documented but not quantified                              | 2     |
| 13  | No holdings, so no overlap, concentration, sector or credit quality             | 3     |
| 14  | No riskometer, exit load, lock-in, minimum investment, manager or tenure        | 3     |
| 15  | No scheme search or autocomplete across 38k schemes                             | 1     |
| 16  | No fund tearsheet to print or keep, only CSV                                    | 1     |

---

# Phase 0: corrections before new work

## T0.1 Correct the holdings finding in the data policy

Files: `docs/data-policy.md`.

`docs/data-policy.md` states that no holdings source exists that this project can use.
That conclusion was reached against AMFI and the current NAV provider, and it is no longer complete.
`mfdata.in` publishes a free, no-authentication REST API claiming stock-level holdings, sector allocation and ratios across 14,000+ schemes.
Probed on 2026-09-09 it returned HTTP 522, meaning its origin was down, so it is not a source that can be depended on.

Rewrite the holdings section to say what is actually true: a candidate source exists, it is third party rather than authoritative, its availability is unproven, and holdings are therefore admitted only as an enrichment tier under the rules in T3.1.
Do not change the refusal of AMC scraping, browser automation or paid APIs.

Acceptance: the section names the candidate, states the observed availability problem, and states the enrichment rules.

## T0.2 Record the two regulatory changes that affect the data model

Files: `docs/data-model.md`, `README.md` known limitations.

Two SEBI changes land directly on stored data and must be written down before anyone computes over them.

**Categorisation.**
A circular effective 26 February 2026 supersedes the earlier framework, standardises scheme names, revises category thresholds, and caps portfolio overlap at 50% for sectoral and thematic schemes and between Value and Contra, measured quarterly on a daily-average basis.
Existing schemes have six months to comply.
When an AMC re-categorises a fund, that fund changes peer group, and every leave-one-out peer average silently changes meaning for the whole historical window.

**Expense ratio.**
Total expense ratio is being redefined as a base expense ratio that excludes GST, stamp duty, SEBI fees and exchange charges, alongside a reduction of up to 15 basis points.
The stored TER series is therefore discontinuous across that date and is not comparable across it.

Acceptance: both are in `README.md` under known limitations with dates, and `docs/data-model.md` names the tables that T2.2 and T2.3 will add.

---

# Phase 1: analytics from NAV alone

Nothing in this phase needs a new data source.
This is the cheapest and highest-value work in the plan, and it is what turns a table into a research tool.

## T1.1 SIP XIRR

Files: new `packages/analytics/src/mf_analytics/metrics/cashflow.py`, `pipeline.py`, `apps/api/mf_api/columns.py`, `apps/api/mf_api/methodology.py`, `tests/test_cashflow.py`.

Lumpsum CAGR is not what an Indian investor experiences, because most money arrives monthly.
Compute XIRR over a monthly contribution schedule: one unit invested on each month-end observation in the window, redeemed at the last observation.

Requirements:

- Solve XIRR by Brent's method on the net present value function, bracketed rather than by Newton iteration from a guess, so a pathological series fails to converge rather than returning a plausible wrong root.
- Return a `Metric` with a reason when it does not converge or when the window has fewer than 12 contributions.
- Compute at 1, 3, 5 and 10 years on the same comparable grid every other metric uses, so a scale discontinuity truncates it identically.
- Store as `sip_xirr_1y`, `sip_xirr_3y`, `sip_xirr_5y`, `sip_xirr_10y` on `scheme_metrics_snapshot`.
- Also add `rolling_sip_xirr_3y_median` and `rolling_sip_xirr_5y_median`, computed over every overlapping window, subject to the existing `MF_MIN_ROLLING_WINDOWS` floor.

Acceptance: a synthetic NAV series growing at a constant 12% annually gives an SIP XIRR within 1e-6 of 0.12, and a series with a known irregular path matches a value computed independently in a spreadsheet, asserted in the test.

## T1.2 After-tax and after-exit-load returns

Files: new `packages/analytics/src/mf_analytics/metrics/tax.py`, `apps/api/mf_api/main.py`, `apps/web/src/app/fund/[scheme_code]/behaviour-panels.tsx`, `tests/test_tax.py`.

Returns net of tax and exit load are what the investor keeps.
Model this as a display layer over an existing gross return, never as a stored ranking column, because the rate depends on the holder.

Rules to implement, all read from `.env` so a rate change is a config change:

- Equity-oriented, meaning the fund's category is equity or a hybrid with 65% or more equity: long-term gains above a threshold at the long-term rate for holdings over 12 months, short-term rate below that.
  Defaults `MF_LTCG_RATE=0.125`, `MF_LTCG_EXEMPTION=125000`, `MF_STCG_RATE=0.20`, `MF_LT_HOLDING_MONTHS=12`.
- Debt-oriented, meaning under 65% equity, for units acquired on or after 1 April 2023: taxed at the holder's slab rate regardless of holding period.
  Default `MF_SLAB_RATE=0.30`, and the UI must say this is an assumption about the holder, not a property of the fund.
- Exit load subtracted at redemption when the holding period is inside the load period, using the exit load field added in T3.2.
  Until that field exists, this term is null with reason `exit_load_not_published`, never zero.

Requirements:

- Equity orientation comes from `clean_category` and `clean_sub_category`, and where neither settles it the result is null with reason `tax_treatment_undetermined`.
  Do not guess.
- Expose as `GET /schemes/{code}/net-returns?horizon=&mode=lumpsum|sip`.
- The fund page shows gross, after tax, and after tax and load side by side, with the assumed rates named on screen.

Acceptance: a 5-year equity lumpsum with a known gain reproduces a hand-computed net figure; a debt fund returns the slab treatment; a fund whose orientation cannot be determined returns null with the reason and the UI renders the reason.

## T1.3 Promote behaviour metrics into the snapshot

Files: `pipeline.py`, `apps/api/mf_api/columns.py`, `apps/api/mf_api/screen.py`, `apps/web/src/components/column-picker.tsx`.

`capture_ratios`, `drawdown_episodes` and `calendar_year_returns` already exist and are computed live per fund.
They cannot be screened on, sorted by, or exported, which is where their value is.

Add to `scheme_metrics_snapshot`: `upside_capture_3y`, `downside_capture_3y`, `upside_capture_5y`, `downside_capture_5y`, `max_drawdown_5y_recovery_days`, `worst_calendar_year_return`, `worst_calendar_year`, `positive_calendar_years_pct`.

Requirements:

- Capture is against the leave-one-out peer series, matching what `/behaviour` already does, and the column label must say so, because capture against a benchmark and capture against peers are different numbers.
- Recovery days is null with reason `not_recovered` when the fund has not regained its peak, never a large number standing in for "never".
- The live `/behaviour` endpoint and the snapshot must agree.
  Add a test that asserts it for a fixture fund.

Acceptance: the screener can sort by downside capture; the snapshot value and the live endpoint value are equal to within floating point for the fixture fund.

## T1.4 Quartile persistence

Files: new `packages/analytics/src/mf_analytics/metrics/persistence.py`, `pipeline.py`, `tests/test_persistence.py`.

Past performance chasing is the single most common investor error, and the honest answer to it is a measurement of whether rank persists.

For each scheme and each of 3y and 5y, rank the fund inside its `clean_sub_category` at every month end using the trailing return ending that month, assign a quartile, and report:

- `quartile_now_3y`, `quartile_now_5y`.
- `quartile_persistence_3y`: the share of month ends over the last five years where the fund was in the same quartile it is in now.
- `quartile_top_share_3y`: the share of month ends where it was in the top quartile.
- `quartile_transitions_3y`: how many times it changed quartile.

Requirements:

- Ranking requires the existing minimum peer count, and is null with `insufficient_peer_universe` below it.
- Ranks are computed on the same universe the snapshot uses, and the peer universe string is stored alongside, as the existing metrics do.

Acceptance: a synthetic category where one fund is always best gives persistence 1.0 and zero transitions; a category where two funds alternate gives a transition count equal to the number of alternations.

## T1.5 Rolling style exposure and style drift

Files: `packages/analytics/src/mf_analytics/metrics/exposure.py`, `apps/api/mf_api/main.py`, `apps/web/src/app/fund/[scheme_code]/`, `tests/test_exposure.py`.

`style_exposure` fits one window.
Refit it on a rolling 36-month window stepped monthly and you get style drift, which no free Indian tool offers and which needs no new data.

Requirements:

- `GET /schemes/{code}/exposure?rolling=true` returns a series of weight vectors with the window end date and the R-squared of each fit.
- A window below the R-squared floor is omitted from the series with its reason, rather than carrying forward the previous weights.
- Add a scalar `style_drift_3y` to the snapshot: the mean absolute change in weights between consecutive windows, summed across the basis and halved so it reads as a turnover fraction between 0 and 1.
- The UI renders it as a stacked area chart over time, and states plainly that this is inferred from NAV and is not a holdings statement.

Acceptance: a synthetic fund built as a fixed 50/50 mix of two basis series gives drift near zero; one that switches from basis A to basis B halfway gives a drift spike at the switch and near zero elsewhere.

## T1.6 Correlation matrix and basket analysis

Files: new `packages/analytics/src/mf_analytics/metrics/basket.py`, `apps/api/mf_api/main.py`, new `apps/web/src/app/basket/`, `tests/test_basket.py`.

This is the NAV-only 80% of what a portfolio overlap tool gives, and it works today.

Requirements:

- `POST /basket` accepts up to 10 scheme codes with weights summing to 1, and returns: the pairwise monthly-return correlation matrix over matched months, the blended monthly return series, blended CAGR, volatility, Sharpe, maximum drawdown and capture, and the diversification benefit, being the weighted average of component volatilities minus the blended volatility.
- Matched months only, with the matched count returned, and the whole response null with `insufficient_history` below the existing 3-year floor.
- Equal weights are the default when weights are omitted.
- The UI is a page where a user picks funds, sees the correlation heatmap, and sees blended risk against each component.
- State on the page that correlation of returns is not portfolio overlap, and that two funds holding different stocks can still be highly correlated.

Acceptance: a basket of one fund reproduces that fund's own metrics exactly; two perfectly correlated synthetic funds give a diversification benefit of zero; two uncorrelated ones give a positive benefit matching the closed-form value.

## T1.7 Alpha significance

Files: `packages/analytics/src/mf_analytics/metrics/risk.py`, `pipeline.py`, `apps/web/src/app/methodology/page.tsx`.

`alpha_beta` already stores alpha, R-squared and the observation count.
Alpha without a standard error, screened across 36,917 schemes, is a multiple-comparisons machine.

Requirements:

- Add `alpha_tstat_3y`, `alpha_tstat_5y`, `alpha_tstat_10y` and `alpha_pvalue_*`, computed from the OLS residual standard error.
- The methodology page states how many funds out of the screened universe would be expected to clear a given t-statistic by chance alone, and the screener shows that note whenever alpha is used as a filter.
- Do not apply a correction silently.
  State the problem and let the user see it.

Acceptance: on synthetic data with a known alpha and known residual variance, the t-statistic matches the closed-form value; on pure noise, the share of funds with p below 0.05 is near 0.05 in the test fixture.

## T1.8 Composite score and shortlisting

Files: new `packages/analytics/src/mf_analytics/scoring.py`, `apps/api/mf_api/main.py`, `apps/web/src/app/picks/`, `docs/data-model.md`, `tests/test_scoring.py`.

The product claims shortlisting and currently ships five preset filters.
A shortlist needs a rank, and a rank is only defensible if it explains itself.

Requirements:

- Score components, each computed as a within-sub-category percentile so that categories are never mixed: risk-adjusted return, consistency, drawdown behaviour, cost, and size discipline.
  Build them from what now exists: Sharpe or Sortino, rolling median and quartile persistence, downside capture and maximum drawdown, expense ratio, and AUM relative to the sub-category once T2.3 lands.
- Weights live in a single declared table in `scoring.py` and are shown to the user.
  There is no hidden weighting.
- `GET /score/{code}` returns the total plus each component's percentile and its contribution in points, so the answer to "why is this ranked above that" is on screen.
- A fund missing a component is scored on the components it has, with the missing ones named and the total flagged `partial`.
  It is never imputed to the category mean, because that would flatter a fund whose data is absent.
- The score is never called a rating or a recommendation, in code, in the API, or in the UI.

Acceptance: reordering the input rows does not change any score; removing a component from the weights changes only that component's contribution; a fund with a null Sharpe is flagged partial and its total omits that component rather than substituting one.

## T1.9 Scheme search

Files: new `apps/web/src/components/scheme-search.tsx`, `apps/api/mf_api/main.py`.

There is no way to find a fund by name across 38,203 schemes, and browsing a filtered table is not the same thing.
This is a research entry point rather than a platform feature, which is why it sits here.

Requirements:

- `GET /search?q=` matching scheme name and AMC, backed by a DuckDB full-text index rather than a `LIKE` scan over the master.
- A typeahead in the header on every page, keyboard navigable, landing on the fund page.
- Results show plan and option, because the same fund appears several times until T2.1 groups it.

Acceptance: a partial name returns the fund within 100ms on the full 38k dataset; a query matching nothing renders an empty state rather than a spinner.

## T1.10 Fund tearsheet

Files: `apps/web/src/app/fund/[scheme_code]/`, `apps/web/src/app/globals.css`.

CSV export exists, and a one-page fund summary is what is actually worth keeping or sending.

Requirements:

- A print stylesheet producing a single-page summary: identity, returns, rolling distribution, risk, drawdowns, cost, style exposure, and every missing-data reason.
- The methodology version and the as-of date in the footer, and the disclaimer on the page rather than behind a link.

Acceptance: printing the fund page fits one page for a fund with full data, and states the reason set for a fund without it.

---

# Phase 2: identity and correctness

Everything here fixes a number that is currently wrong or unmeasurable, rather than adding a feature.

## T2.1 Fund family identity

Files: `packages/analytics/src/mf_analytics/classify.py`, `ingest/master.py`, `db.py`, `pipeline.py`, `tests/test_classify.py`.

Direct and Regular, Growth and IDCW, are separate scheme codes for one economic fund.
Every count, every category average and every top-ten list is currently inflated by them.
Mergers and renames also split one fund's history across codes.

Requirements:

- Add `fund_family_id` to `scheme_master`, derived from ISIN where the growth and IDCW ISINs tie variants together, and otherwise from the scheme name with plan and option tokens stripped by the existing name normalisation in `classify.py`.
- Add a `scheme_alias` table mapping a retired scheme code to its successor, with the effective date and the evidence used.
  Populate only where the evidence is unambiguous, and leave the rest unmapped rather than guessed.
- The screener's default universe becomes one row per `fund_family_id`, choosing the Direct Growth variant, with the other variants reachable from the fund page.
- `make validate` reports how many codes collapsed into families and how many resisted grouping.

Acceptance: for a fixture AMC, the Direct and Regular Growth codes of one fund share a `fund_family_id`; a fund with no ISIN and an unusual name is left ungrouped rather than merged with a similarly named fund; scheme counts on the dashboard drop by the expected number.

## T2.2 Category history

Files: `db.py`, `ingest/master.py`, `pipeline.py`, `tests/test_classify.py`.

`clean_sub_category` is a single current value.
The SEBI circular of 26 February 2026 will move funds between categories inside a six-month window, and when that happens every historical peer average silently changes what it means.

Requirements:

- Add `scheme_category_history` with scheme code, category, sub-category, valid-from and valid-to, and the ingest run that observed the change.
- Populate it on every master ingest by diffing the incoming category against the stored one, so history accrues from now on.
  Do not backfill history you cannot observe.
- Peer grouping resolves the category as of the window's end date, not as of today, and the snapshot records which resolution it used.
- The fund page shows a note when the fund's category changed inside the window being displayed.

Acceptance: a fixture where a scheme changes sub-category mid-series produces two history rows, and a 5-year peer comparison ending after the change uses the new category while one ending before it uses the old.

## T2.3 AUM history

Files: `ingest/master.py`, `db.py`, `pipeline.py`.

`latest_aum` is one quarterly figure for one plan and option variant, with no history.
Asset bloat is the central risk in small-cap and mid-cap funds and it is invisible without a series.

Requirements:

- Add `scheme_aum_history` keyed by scheme code and quarter, appended on each master ingest, never overwritten.
- Add `aum_family_latest`, the sum across the fund family from T2.1, which is the figure that is comparable to a factsheet.
- Add `aum_growth_4q` and `aum_percentile_in_sub_category` to the snapshot, feeding the size-discipline component of T1.8.
- Keep the README's existing caveat that this is a SEBI-standardised quarterly average and will not match a month-end factsheet figure.

Acceptance: two ingests a quarter apart produce two history rows and a correct growth figure; a fund family's aggregate exceeds any single variant's figure.

## T2.4 Quantify survivorship bias

Files: `pipeline.py`, `apps/api/mf_api/main.py`, `apps/web/src/app/methodology/page.tsx`.

The README documents survivorship bias and the universe toggle already allows including matured schemes.
Documenting a bias is not measuring it.

Requirements:

- Compute every category aggregate twice, over active-only and over all schemes including matured ones, and store both.
- `GET /categories/{key}/metrics` returns both with the difference, and the methodology page states the gap per category in percentage points.
- The screener shows the category-level gap wherever a category average is displayed.

Acceptance: for a fixture category containing a matured underperformer, the all-schemes average is below the active-only average by the hand-computed amount.

---

# Phase 3: the enrichment tier

Everything in this phase is data this project does not compute and cannot verify.
It is therefore fenced.

## T3.1 The enrichment contract, built before any enrichment source

Files: new `packages/analytics/src/mf_analytics/enrich/__init__.py`, `db.py`, `docs/data-policy.md`.

Build the fence first, so no later task can quietly put third-party data into a return.

Requirements:

- Every enrichment table carries `source`, `source_url`, `fetched_at` and `as_of`, and no row exists without all four.
- A single module-level assertion, exercised by a test, that no column from an enrichment table appears in `scheme_metrics_snapshot`, in any ranking, or in any risk computation.
- Enrichment fetches have their own timeout and retry settings, and a failure produces a named-reason null across the dependent UI rather than an error page or a stale value presented as current.
- A staleness threshold in `.env`: past it, the UI labels the value as stale with its `as_of` date.
- `make validate` reports enrichment coverage and staleness alongside the existing checks.

Acceptance: a test that imports the snapshot column list and the enrichment column list and asserts the intersection is empty; a test that simulates the source being unreachable and asserts the fund page still renders with reasons rather than errors.

## T3.2 Scheme attributes that decide a shortlist

Files: `packages/analytics/src/mf_analytics/enrich/attributes.py`, `db.py`, `apps/api/mf_api/columns.py`, `apps/web/src/components/filter-drawer.tsx`.

Add `scheme_attributes` carrying riskometer, exit load and its period, lock-in period, minimum investment, minimum SIP, the benchmark named in the scheme information document, fund manager, and manager start date.

Requirements:

- These become screener filters, because they are decisive at shortlist time.
  An exit load is not a footnote: it changes realised return, and T1.2 consumes it.
- Riskometer is a SEBI-mandated monthly disclosure, so it carries an `as_of` month and is shown as stale past one month.
- Manager tenure is derived from the manager start date at query time, never stored as a number that ages.
- A fund the source does not carry shows blank with a named reason, never a default.

Acceptance: the screener can filter to funds with no exit load and a manager tenure over three years; a fund absent from the source shows named reasons in every one of these cells.

## T3.3 Holdings, and what they unlock

Files: `packages/analytics/src/mf_analytics/enrich/holdings.py`, `db.py`, `apps/api/mf_api/main.py`, new `apps/web/src/app/overlap/`.

Only start this after T3.1 is merged and after the candidate source has been observed to be available across a week of scheduled checks.
If it is not reliably available, stop and say so in `docs/data-policy.md` rather than building on it.

Requirements:

- `scheme_holdings` keyed by scheme code, as-of month, instrument identifier, name, weight and quantity, plus the enrichment provenance columns from T3.1.
- Derived views: top-ten concentration, sector allocation, market-capitalisation split, and for debt funds credit quality and duration where the source carries them.
- `GET /overlap` taking two to five scheme codes, returning the shared holdings with both weights and the overlap percentage, computed as the sum of the minimum weight per shared instrument.
- Portfolio turnover between consecutive monthly snapshots.
- The overlap page states the as-of month prominently, because holdings are a month-old photograph and a fund can have traded since.
- Cross-check against the returns-based exposure already computed, and where the two disagree materially, show both rather than hiding one.
  That disagreement is information.

Acceptance: two identical scheme codes give 100% overlap; two funds with disjoint holdings give 0%; the overlap of a fund with itself under a different plan code is 100% once T2.1 groups them; an unreachable source yields a named reason rather than an empty page.

---

# Out of scope

State these plainly so nobody builds them by drift.

- Transactions, order placement, or any execution.
- Advice, recommendations, model portfolios, or anything that ranks funds for a named investor's circumstances.
- FX conversion of a benchmark.
- Scraping AMC websites, browser automation to collect investment data, or any paid data API.
- Backfilling data that was never observed, including category history before T2.2 lands.

# Sequencing summary

Phase 1 is independent of everything else and should start immediately.
Phase 2 must precede the size-discipline component of T1.8 and the overlap work in T3.3.
Phase 3 must not start before T3.1.

There is deliberately no platform phase.
This runs locally for one person, so authentication, containers, CI, hosted watchlists and shareable links are not built.
The consequences are accepted rather than overlooked: `POST /admin/refresh` and the two benchmark admin routes stay unauthenticated, saved screens stay in browser storage, and the refresh is run by hand or by a local cron calling the API rather than the CLI, because the API holds the DuckDB write lock.
If this is ever exposed beyond loopback, that decision reopens and a bearer token on the admin routes is the first thing to add.

# Sources consulted

- SEBI categorisation framework update, effective 26 February 2026: https://www.angelone.in/news/mutual-funds/sebi-updates-mutual-fund-categorisation-framework
- Analysis of the draft circular and overlap caps: https://indiacorplaw.in/2025/08/06/sebis-draft-mutual-fund-circular-navigating-diversification-and-investor-protection/
- TER to base expense ratio redefinition: https://www.valueresearchonline.com/stories/227233/sebis-ter-overhaul-what-mutual-fund-investors-must-know/
- SEBI riskometer, monthly disclosure: https://investor.sebi.gov.in/riskometer.html
- Mutual fund taxation, FY 2025-26: https://www.finnovate.in/learn/blog/mutual-fund-taxation-india-fy-2025-26
- Candidate holdings API, availability unproven: https://mfdata.in/ and https://mfdata.in/docs
- Portfolio overlap as a product category: https://www.dezerv.in/mutual-funds/portfolio-overlap/
- AMFI AUM disclosures: https://www.amfiindia.com/aum-data/average-aum
- Feature baselines from Morningstar and Value Research: https://www.morningstar.in/tools/mutual-fund-performance-comparison.aspx and https://tryaltys.ai/blog/best-mutual-fund-research-tools-india/
