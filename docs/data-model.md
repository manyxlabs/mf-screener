# Data model

Everything lives in one DuckDB file (`data/processed/mf.duckdb`) plus a Parquet lake under `data/processed/`.
No cloud database, no credentials.

## Where each table comes from

| Table                       | Kind                               | Built by                                         |
| --------------------------- | ---------------------------------- | ------------------------------------------------ |
| `scheme_master`             | table                              | `make data-master` / `make data-sample`          |
| `scheme_category_history`   | table                              | diffed on every `make data-master`               |
| `scheme_alias`              | table                              | diffed on every `make data-master`               |
| `nav_daily`                 | view over year-partitioned Parquet | `make data-nav` / `make data-sample`             |
| `nav_monthly`               | table                              | derived in SQL from `nav_daily`                  |
| `monthly_returns`           | table                              | derived in SQL from `nav_monthly`                |
| `rolling_returns_monthly`   | table                              | `make metrics`                                   |
| `nav_zero_excluded`         | table                              | every NAV ingest, from the rows it dropped       |
| `benchmarks`                | table                              | `make benchmark-import` / `make benchmark-proxy` |
| `scheme_benchmark_map`      | table                              | `make benchmark-map`                             |
| `category_monthly_returns`  | table                              | `make metrics`                                   |
| `category_metrics_snapshot` | table                              | `make metrics`                                   |
| `scheme_metrics_snapshot`   | table                              | `make metrics`                                   |
| `ingest_log`                | table                              | every pipeline step                              |
| `raw_file`                  | table                              | every raw download, keyed by path                |

`nav_daily` is a view rather than a table on purpose: 37M rows stay in compressed Parquet partitioned by year, and the database file stays small enough to copy around.

## How the lake is written

Bulk ingestion never materialises the history in Python.
DuckDB reads the source Parquet, applies the normalisation and deduplication rules below, and writes the partitioned output in one streaming `COPY ... PARTITION_BY (year)`.

Writes land in `nav_daily.staging` and are then promoted directory by directory.
Two things follow from that.
Readers never observe a half-written lake, since promotion is a rename per year partition.
And a partial rewrite becomes possible at all: DuckDB's `PARTITION_BY ... OVERWRITE` clears the entire output directory rather than only the partitions being written, so `make data-refresh` writes just the affected years to staging and swaps those in, leaving every other year's files untouched on disk.

Promotion refuses to run when the incoming relation produced no partitions.
An empty or failed source therefore leaves the existing lake exactly as it was instead of erasing it.

Where the same `(scheme_code, date)` arrives from two places - the stored partition and a fresh top-up - the more recently fetched row wins.

## Source mapping

The canonical schema is derived from the provider's live catalog, not from assumptions.
`make inspect` prints the source columns and the mapping, and flags anything that disappeared upstream.

| Source column                   | Canonical column                   | Note                                                             |
| ------------------------------- | ---------------------------------- | ---------------------------------------------------------------- |
| `scheme_code`                   | `scheme_code`                      | AMFI numeric code, the primary key                               |
| `isin` / `isin2`                | `isin_growth` / `isin_dividend`    | IDCW-reinvestment classes carry their identifier in `isin2` only |
| `category_sub`                  | `sub_category`                     | blank for ~25,000 old-style filings                              |
| `category`                      | `category`                         | raw AMFI text, used as the sub-category fallback                 |
| `category_group_clean`          | `clean_category`                   | the stable 4-value grouping                                      |
| `scheme_plan` / `scheme_option` | `plan` / `option`                  | raw; the cleaned versions are derived                            |
| `first_date` / `last_date`      | `first_nav_date` / `last_nav_date` | also the basis for `fund_age_years`                              |
| `aaum_cr_quarterly_avg`         | `latest_aum`                       | quarterly average AUM per scheme code, in crore                  |
| `aaum_quarter_end`              | `aum_date`                         | sort on this, display `aum_quarter`                              |
| `nav` / `nav_date`              | `latest_nav` / `latest_nav_date`   | for a matured scheme this is its final frozen NAV                |

AMFI publishes no launch date, so `launch_date` is set to the first NAV date and labelled as a proxy.

## Derived classification

`classify.py` adds four columns that the raw feed does not provide cleanly:

- `clean_plan` - Direct / Regular / Unknown. The source field wins; the scheme name only breaks ties it leaves open. Pre-2013 schemes predate the Direct/Regular split and stay Unknown by design rather than being guessed into a bucket.
- `clean_option` - Growth / IDCW Payout / IDCW Reinvestment / Other / Unknown. AMFI publishes only Growth/IDCW/Bonus/Other, so payout versus reinvestment is read from the scheme name.
- `clean_category`, `clean_sub_category` - the stable grouping, with the raw AMFI category text as the fallback where SEBI never assigned a sub-category.
- `fund_family_id` (T2.1) - ties the Direct/Regular and Growth/IDCW scheme codes of one economic fund together. See below.

`category_key` encodes the whole peer methodology, not just the label:

```
sub_category=Mid Cap Fund|plan=direct|option=growth|active=y|agg=mean
```

Two different methodologies therefore produce two different keys and can coexist in `category_monthly_returns` without one silently overwriting the other.

## Fund family identity (T2.1)

Direct and Regular, Growth and IDCW, are separate `scheme_code` rows for one economic fund, and every raw count over `scheme_master` used to be inflated by them.
`fund_family_id` in `scheme_master`, added by `classify.py`, groups those rows together so the default screener view and every "how many funds" count can be one row per fund rather than one row per plan/option combination.

Grouping uses two ties, in order of trust, and never a fuzzy one:

1. **ISIN.** Two rows that share a value in `isin_growth` or `isin_dividend` are the same unit under two option labels.
2. **AMC + normalised name.** `normalise_fund_name` strips plan and option words (Direct, Regular, Growth, IDCW, Payout, Reinvestment, Bonus, Plan, Option, Fund) and any `(Formerly ...)` parenthetical, the same way `cap_band` and `style` already exclude it. An exact match on what remains, combined with the AMC, ties the rest together.

A name that normalises to fewer than 6 characters (`"ELSS"`, `"Liquid"`) is too generic to trust and is never used for grouping - two fixture funds correctly stayed apart in testing purely because of this floor.
A scheme code that ties to nothing keeps its own code as a family of one.
That is the ungrouped case by construction, not a failure: no ISIN or exact name match cleared the bar, so the code is left alone rather than merged on a guess.
`mf_analytics.pipeline.fund_family_grouping_summary` reports how many codes collapsed into families versus how many resisted grouping, for `make validate`.

`scheme_alias` maps a scheme code retired by a master ingest to the successor that carries its `fund_family_id` forward - a merger or a plan closure without a name or ISIN match otherwise looks like the fund vanished. It is populated only where the evidence is unambiguous: a shared ISIN with exactly one surviving candidate, or failing that an exact `fund_family_key` match to exactly one new code. Anything with zero or more than one candidate is left unmapped rather than guessed, with the `evidence` column recording which tie fired (`isin_match:<isin>` or `name_match:<key>`) for anyone auditing a mapping.

The default `/schemes` and `/screen` results are deduplicated to one row per `fund_family_id`, preferring whichever plan/option the request itself asked for and falling back to the conventional Direct Growth choice; pass `dedupe_families=false` to see every variant.

## Pending regulatory changes to this schema

Two SEBI changes land on stored data and are not yet represented as history.

A circular effective 26 February 2026 supersedes the earlier categorisation framework.
It standardises scheme names, revises category thresholds, and caps portfolio overlap at 50% for sectoral and thematic schemes and between Value and Contra, measured quarterly on a daily-average basis.
Existing schemes have six months from that date to comply.
`clean_category` and `clean_sub_category` are single current values with no history, so when an AMC re-categorises a fund under this circular, every leave-one-out peer average silently changes meaning for the whole historical window it covers.
`scheme_category_history` (T2.2) now carries this: one row per closed or open classification segment, keyed by scheme code and valid-from, with `clean_category`, `clean_sub_category`, `valid_to` (null while the segment is current) and the `observed_run_id` of the ingest that detected the change.
It is populated by diffing each master ingest's incoming category against what `scheme_master` currently holds - a scheme that has never been reclassified since this table existed has no rows in it at all, and nothing before the first observed change is backfilled.
Peer grouping resolves each scheme's category as of the window's end date rather than as of today: it looks up the segment covering that date and falls back to the current `scheme_master` value when none exists.
`scheme_metrics_snapshot.category_resolution` records which of the two it used (`history` or `current`) for that scheme's row.

Separately, total expense ratio is being redefined as a base expense ratio that excludes GST, stamp duty, SEBI fees and exchange charges, alongside a reduction of up to 15 basis points.
The stored TER series is discontinuous across that date and is not comparable across it.
No table carries TER history yet, so this discontinuity is not queryable; a future TER history table will need a scale-break flag of its own, the same way `nav_scale_discontinuity` already marks a NAV redenomination rather than letting the series compound through it.

T2.3 separately adds `scheme_aum_history`, keyed by scheme code and quarter and appended on each master ingest, which is unrelated to either regulatory change but fills the other current single-value gap in this schema.
It is append-only - `(scheme_code, aum_quarter)` is the primary key and re-ingesting a quarter already on record inserts nothing - so `aum_growth_4q` always reads a real series rather than one padded by a repeated run.
`aum_family_latest` sums `latest_aum` across every scheme code sharing a `fund_family_id` (T2.1), the figure comparable to a factsheet total rather than one plan+option variant; `aum_percentile_in_sub_category` ranks that family total, one entry per family, within `clean_sub_category`, so a family split across several scheme codes is not counted several times in its own peer group.

## Data-quality rules enforced at ingest

- A NAV of `0.00` on a matured scheme is AMFI's terminal marker, not a price, and is dropped.
- Duplicate `(scheme_code, date)` rows are collapsed at write time; `make validate` fails if any survive.
- A month whose last NAV lands more than `MF_MONTH_END_TOLERANCE_DAYS` before the month end is not a month-end observation. That excludes the running month, so a part-month is never compared against a full one.
- Monthly returns are only computed between consecutive calendar months. A gap stays a gap; it is never bridged by forward-filling.
- A month whose NAV multiplies or divides by more than `MF_NAV_JUMP_RATIO` (default 2.0) is a unit-basis change, not a market move. AMFI publishes NAVs as filed, so a face-value redenomination or unit split arrives as a single month at exactly x10, x100, /10 or /100 - 789 scheme-months in the current full dataset, clustered on those round multiples rather than spread like market returns. Compounding through one turns a 6% overnight fund into a 67% five-year CAGR. Every published NAV is kept as filed; the scheme's comparable history simply starts at the break, the scheme is flagged `nav_scale_discontinuity`, and any window needing more history than remains returns null with `nav_scale_discontinuity` as the reason. The level is never rescaled, because the true ratio is not something the NAV feed states.
- Rows whose date cannot be parsed are dropped rather than aborting the load, and the gap between the source file's row count and the ingested count is recorded.
- A downloaded file's Parquet footer is checked against the canonical column mapping before anything reads it. A missing required column aborts with the actual source columns printed; a new upstream column is logged as schema drift and ignored.
- A benchmark CSV is validated whole before any row is written: a missing required column, an unparseable date, a zero or negative index level, a duplicate `(benchmark_id, date)`, two currencies under one `benchmark_id`, a non-ISO currency code or a single-row series all reject the file, listing every problem at once with CSV line numbers. A partial import is worse than none, because the gap is invisible once the rows are in the table.
- `currency` on a benchmark CSV is required and never defaulted. An unlabelled S&P 500 file stored as INR would make every benchmark-relative metric an FX measurement, with nothing left in the data to detect it by.
- Every raw download writes a `.meta.json` sidecar with the URL, retrieval time, byte count, SHA-256 and row count, and registers the same in `raw_file`, so any stored metric can be traced back to the snapshot it came from. `make provenance` prints that registry.

## Measurement frequency

Returns, risk and every peer- or benchmark-relative metric are computed from the month-end grid.
Comparing series requires them to sit on the same dates, and funds publish on different days while index data often arrives month-end only, so aligning on daily NAV would mean discarding the days that do not match everywhere or filling the gaps.
Gaps are never filled here.

## Horizons

Trailing returns are published for 1, 3, 5 and 10 years, and rolling windows for the same four.
A 1-year rolling window still yields a long series of overlapping observations, so its median and dispersion are worth reading.

The peer-relative, benchmark-relative and risk metrics stop at 3 years.
A 1-year window holds about 10 matched monthly observations, which is too thin a sample for a beta, a Sharpe or a tracking error that a screener will sort on.
`HORIZONS`, `TRAILING_HORIZONS` and `ROLLING_HORIZONS` in `mf_analytics.config` are the single source for all three sets: the metric vocabulary, the snapshot table columns and the UI all derive from them.

Maximum drawdown is the exception and uses daily NAV.
It measures the path rather than the endpoints, so a month-end sample steps over the trough: through the 2020 crash a month-end grid put a typical equity fund at -23.19% against -33.51% daily.
It also needs no cross-series alignment, so it is the one metric that can use daily data without costing comparability.

`DRAWDOWN_SQL` computes it in DuckDB as a running peak per scheme, aggregated to one row each, so the daily history is streamed rather than materialised.
Eligibility is still judged on the month-end grid, so which schemes report a drawdown is unchanged; only the precision of the number improves.
The daily series starts at any NAV redenomination, exactly as the month-end grid does, or the step itself would register as a 90% crash.

## SIP XIRR

`sip_xirr_1y`, `sip_xirr_3y`, `sip_xirr_5y` and `sip_xirr_10y` model the return a monthly investor actually experienced, as against the lump-sum-in-lump-sum-out trailing CAGR: one unit bought at each month-end NAV in the window, the whole holding redeemed at the window's last observation.
`rolling_sip_xirr_3y_median` and `rolling_sip_xirr_5y_median` are the median of that same computation over every overlapping window, gated by `MF_MIN_ROLLING_WINDOWS` like every other rolling summary.

The rate is annualised on actual calendar days over 365 (the convention a spreadsheet's XIRR function uses), not the nominal-year exponent the rest of this file's CAGR metrics use, because this metric is checked against that convention.
It is solved with a bracketed root finder (Brent's method or an equivalent bisection) rather than a Newton guess from a starting rate, so a cash-flow series with no root between -99.99% and +2000% reports the named reason `sip_xirr_not_bracketed` instead of a plausible wrong rate.
Below 12 monthly contributions in the window it is null with reason `insufficient_observations`, the same reason a short trailing CAGR carries, since it is the same underlying gap: too few month-end observations.
Implemented in `packages/analytics/src/mf_analytics/metrics/cashflow.py`.

## Behaviour metrics in the snapshot

Capture ratios, drawdown recovery and calendar-year returns are computed live by `GET /schemes/{code}/behaviour` since before this section existed, and are now also stored on `scheme_metrics_snapshot` so a screen can sort and filter on them.
The snapshot and the live endpoint call the same functions - `capture_ratios`, `drawdown_episodes`/`DRAWDOWN_SQL` and `calendar_year_returns` - so neither can silently reimplement the other's definition, but they answer different questions and are not expected to return the same number:

- `upside_capture_3y`, `downside_capture_3y`, `upside_capture_5y`, `downside_capture_5y` are windowed to the trailing 3 or 5 years, exactly like every other `_3y`/`_5y` column, against the **leave-one-out sub-category peer average** (`ex_self_returns`, the same series `information_ratio_vs_category_{h}y` uses) - never a benchmark, and the column label says so. `/behaviour`'s `capture` field instead covers the fund's whole history against the whole (not leave-one-out) sub-category average, because it describes a fund's full career on one page rather than a screenable horizon. Below the risk floor for that horizon (24 months at 3y, 42 at 5y) it is null with `insufficient_observations`; with fewer than the configured peer minimum it is null with `insufficient_peer_universe`.
- `max_drawdown_5y_recovery_days` is the calendar days from the trough of the worst 5-year peak-to-trough fall (the same trough `max_drawdown_5y` reports) to the first daily NAV that regained the pre-fall peak, computed by extending `DRAWDOWN_SQL`'s running-peak query rather than re-running `drawdown_episodes` per scheme, which would pull the full daily lake into pandas at bulk scale. **Never a large number standing in for "never"**: a fund that has not yet regained that peak is null with reason `not_recovered`.
- `worst_calendar_year_return`, `worst_calendar_year` and `positive_calendar_years_pct` come from `calendar_year_returns` filtered to complete (12-month) calendar years only - a fund's first and last year are almost always partial and are never compared against a full one. Below `MIN_CALENDAR_YEARS` (3) complete years, all three are null with reason `insufficient_history`.

Implemented in `packages/analytics/src/mf_analytics/pipeline.py`; `not_recovered` is defined there (with its UI description merged into `/methodology`) rather than in `mf_analytics.quality`, the same way `metrics/cashflow.py` keeps its own SIP-XIRR-specific reasons.

## Quartile persistence

Past performance chasing is the single most common investor error, and `quartile_now_3y`, `quartile_now_5y`, `quartile_persistence_3y`, `quartile_top_share_3y` and `quartile_transitions_3y` measure the honest answer to it: whether a fund's peer-relative rank holds up over time, rather than just what it is today.

At every month end, every scheme in a `clean_sub_category` is ranked by its trailing return ending that month (the same series `rolling_returns_monthly` already stores) and split into four equal-sized groups.
`quartile_now_{3,5}y` is the group the fund is in as of the latest ranked month end.
`quartile_persistence_3y` is the share of month ends in the last 5 years where the fund's 3-year quartile matched the quartile it is in now; `quartile_top_share_3y` is the share of those month ends spent in the top quartile; `quartile_transitions_3y` counts the month-to-month changes in that quartile over the same 5 years.
Only the 3-year horizon carries persistence, top-share and a transition count - a 5-year quartile inside a fixed 5-year lookback window would be little more than "now" repeated.

Ranking the whole universe at every month end is a bulk operation: it runs as one DuckDB window-function query (`ntile(4)` partitioned by category, horizon and date) over `rolling_returns_monthly`, joined to the same peer membership `build_category_contexts` already computed, never as a per-scheme rank in pandas.
It requires the existing minimum peer count (`MF_MIN_PEERS`) at that month end, the same floor every other peer-relative metric uses; below it, and for any scheme with no ranked month end at all, every one of these five columns is null with reason `insufficient_peer_universe`.
The peer universe used is stored alongside on the same `peer_universe` column every other peer-relative metric already carries.

Implemented in `packages/analytics/src/mf_analytics/metrics/persistence.py`, wired into `pipeline.py` after `rolling_returns_monthly` is fully written for the run.

## Style exposure and drift

`GET /schemes/{code}/exposure` fits a fund's monthly returns to the style-factor basis (`benchmarks` rows with `asset_class = 'Style Factor'`) as a long-only mix summing to one - never a holdings statement, since AMFI publishes no portfolio for any Indian fund.
`style_drift_3y` is the one piece of that analysis stored on `scheme_metrics_snapshot`: the same fit refit on every trailing 36-month window stepped one month at a time (`rolling_style_exposure`), restricted to windows ending in the last 3 years, then averaged as turnover - half the sum of absolute weight changes across the basis - between each pair of consecutive windows that both clear the R-squared floor.
0 is an unchanged mix, 1 a complete switch from one factor to another.

A window whose fit falls below the R-squared floor (`MIN_R_SQUARED_DEFAULT`, 0.5, the same floor the single-window fit uses) is dropped from the series with reason `style_basis_does_not_describe_this_fund` rather than carrying the previous window's weights forward - so a stretch of unfitted windows never manufactures a drift reading out of two unrelated fits either side of it.
Below 2 fitted windows in the last 3 years, `style_drift_3y` is null with reason `insufficient_rolling_windows`; with no style-factor basis loaded at all, it is null with `benchmark_unavailable`.

Implemented in `packages/analytics/src/mf_analytics/metrics/exposure.py` (`rolling_style_exposure`, `style_drift`), wired into `pipeline.py` alongside the other per-scheme metrics.

## Alpha significance

`alpha_tstat_{3,5,10}y` and `alpha_pvalue_{3,5,10}y` sit alongside `alpha_{h}y` on `scheme_metrics_snapshot`, from the same OLS fit as `alpha` and `beta`.

The t-statistic tests the regression's monthly intercept against zero, `t = alpha_m / se(alpha_m)`, with `se(alpha_m) = sqrt(sigma^2 * (1/n + xbar^2 / Sxx))` and `sigma^2` the residual variance (`n - 2` degrees of freedom).
It is computed on the monthly intercept rather than the annualised `alpha` shown elsewhere, because annualising first would test a nonlinear transform of the estimate rather than the estimate itself.
The p-value is the two-sided tail probability against a Student's t distribution with `n - 2` degrees of freedom, evaluated from the regularised incomplete beta function (no scipy dependency).
Both share `alpha`'s eligibility: the same `MIN_RISK_OBS` floor per horizon (24 at 3y, 42 at 5y, 84 at 10y), and null with reason `zero_or_invalid_denominator` when the fit is a perfect line with no residual variance to estimate a standard error from.

No multiple-comparisons correction (Bonferroni, Benjamini-Hochberg or otherwise) is applied anywhere in this project.
Screened across the roughly 36,917 schemes in the metrics snapshot, about 5% - on the order of 1,846 funds - are expected to clear `p < 0.05` by chance alone even with zero true skill.
`GET /methodology` states this count explicitly (`alpha_significance.expected_false_positives_at_p05`), and the screener and the methodology page both surface it whenever an `alpha_*` range is used as a filter, rather than applying a silent correction.

Implemented in `packages/analytics/src/mf_analytics/metrics/risk.py` (`alpha_beta`, extended to return `alpha_tstat`/`alpha_pvalue` alongside `alpha`/`beta`/`r_squared`), wired into `pipeline.py` alongside the rest of the benchmark regression.

## Benchmarks and currency

`benchmarks` holds one month-end row per `(benchmark_id, date)`, carrying the index level, its monthly return and the currency the series is quoted in.
`scheme_benchmark_map` assigns one benchmark per scheme from `packages/analytics/benchmark_map.yaml`, recording `confidence` as `high`, `fallback` or `currency_mismatch`.

Fund NAVs are published in INR (`BASE_CURRENCY`).
A benchmark in any other currency is kept and displayed but never compared: `alpha`, `beta`, `r_squared`, `tracking_error`, `information_ratio_vs_benchmark`, `benchmark_return`, `fund_minus_benchmark` and `rolling_*_beat_benchmark_pct` are all null with reason `benchmark_currency_mismatch`, and the scheme carries the matching flag.
Peer-relative metrics are unaffected, because they never touch the benchmark.

The guard sits at four independent layers, because an FX-contaminated alpha looks entirely plausible:

1. the CSV import refuses a file with no `currency` column, and refuses one mixing currencies under a single `benchmark_id`;
2. `apply_mapping` prefers an INR series over a foreign one wherever it sits in the configured fallback order, and labels the mapping `currency_mismatch` when only a foreign series exists;
3. `load_benchmarks` raises if the table somehow holds two currencies for one id, rather than taking whichever row sorts first;
4. the pipeline withholds every benchmark-relative metric and records the reason, so the UI states which index is mapped and why its columns are blank instead of showing dashes that read as missing data.

An index-fund proxy is always INR by construction: it is derived from an AMFI NAV, and a feeder fund tracking a US index files that NAV in rupees, having already absorbed the exchange rate.

## Data-quality flags

`scheme_metrics_snapshot.data_quality_flags` carries any of:
`nav_gaps`, `nav_scale_discontinuity`, `insufficient_history_1y`, `insufficient_history_3y`, `insufficient_history_5y`, `insufficient_history_10y`, `terminal_zero_nav_excluded`, `possible_merger_or_rebrand`, `no_category`, `no_benchmark_mapping`, `benchmark_currency_mismatch`, `plan_ambiguous`, `option_ambiguous`, `inactive_or_matured`, `stale_source_record`.

`insufficient_history_{h}y` fires when the scheme has fewer than `12 * h` month-end observations, one flag per horizon it cannot support.
`terminal_zero_nav_excluded` marks a scheme whose source history contained a non-positive NAV; those rows are dropped at ingest, and `nav_zero_excluded` records which schemes they belonged to.
`possible_merger_or_rebrand` marks an active scheme with under three years of NAV whose peer group's median member started more than five years earlier - AMFI issues a fresh scheme code on a merger or rename, so a young code among long-lived peers is more often a reissued one than a new fund.
It is a hint to check, not a finding.

`missing_reasons` maps each null metric to the reason it could not be computed, and `/columns` returns the human-readable text for each reason.

## Composite score

`GET /score/{scheme_code}` computes a weighted percentile score against the fund's own `clean_sub_category` peers - never a rating or a recommendation, a decomposition the caller can audit component by component.
Peers are the same Direct-Growth, active universe the default screener and `_cost_position` already use, so "peer" means the same thing everywhere in the app.

Five components, each a percentile in `[0, 1]` within that peer group (1 is best), weighted per the declared table in `packages/analytics/src/mf_analytics/scoring.py` and echoed on every response so there is no hidden weighting:

| Component              | Weight | Built from                                         | Combination |
| ---------------------- | -----: | -------------------------------------------------- | ----------- |
| `risk_adjusted_return` |   0.30 | `sharpe_5y`, falling back to `sortino_5y`          | fallback    |
| `consistency`          |   0.20 | `rolling_5y_median`, `quartile_persistence_3y`     | average     |
| `drawdown_behaviour`   |   0.20 | `downside_capture_5y`, `max_drawdown_5y`           | average     |
| `cost`                 |   0.15 | `expense_ratio` (lower is better)                  | average     |
| `size_discipline`      |   0.15 | `aum_percentile_in_sub_category` (lower is better) | average     |

A component needs `MF_MIN_PEERS` peers with a non-null value in the underlying metric, the same floor every other peer-relative metric in this document uses; below it the component is null with reason `insufficient_peer_universe`.
`size_discipline` (T2.3) is scored on `aum_percentile_in_sub_category`, itself already a percentile of `aum_family_latest` within the sub-category, so a smaller fund family scores higher - asset bloat is the risk this component exists to flag.
It is null with `insufficient_peer_universe` where the sub-category has fewer than `MF_MIN_PEERS` families with a computed AUM total, and with `aum_history_not_available` only for a store that predates T2.3 and has never computed the column at all; neither case is ever imputed to the category mean.

A fund missing one or more components is still scored on the ones it has: the total sums only the present components' contributions (`percentile * weight * 100`, never rescaled to fill the missing weight), `status` is `"partial"`, and `missing_components` names which ones did not count.
Reordering the peer rows never changes a score, since every percentile comes from `pandas.rank(pct=True)` against the set of peer values, not their order.
Removing a component from the weight table changes only that component's own contribution - every other component's percentile and contribution are computed independently and are untouched.

Implemented in `packages/analytics/src/mf_analytics/scoring.py`, called live from `GET /score/{scheme_code}` in `apps/api/mf_api/main.py` over the small per-sub-category peer group fetched from `screen_base`, never over the full NAV lake.

## Enrichment tables (T3.1, T3.2, T3.3)

Two are registered: `scheme_attributes` (T3.2) and `scheme_holdings` (T3.3). Neither is in the canonical table above.
`packages/analytics/src/mf_analytics/enrich/` is the fence that any of them must be declared through: an `EnrichmentTable` names its own domain columns and key columns, and `EnrichmentRegistry.create_sql()` adds the four provenance columns on top of every one of them, so a table can never be declared, and a row can never be inserted, without `source`, `source_url`, `fetched_at` and `as_of` all `NOT NULL`.

Two guarantees the registry gives every future enrichment table for free:

- `EnrichmentRegistry.column_names()` is the union of every registered table's domain columns (its keys and provenance excluded, since those are join scaffolding, not fund data). `assert_disjoint_from_snapshot(snapshot_columns)` intersects that set against `scheme_metrics_snapshot`'s real, introspected column list and raises if a column was added to both - so an enrichment column reaching the snapshot, a ranking or a risk computation is a failing test, not a review comment.
- `EnrichmentRegistry.coverage_and_staleness(con, universe_size)` returns row count, coverage percentage and stale-row count per registered table, against `MF_ENRICH_STALE_DAYS` (default 45 days: one SEBI monthly disclosure cycle plus a grace window). Empty until a table is registered.

Enrichment fetches run through `enrich_http_settings()`, a `Settings` copy substituting `MF_ENRICH_HTTP_TIMEOUT`/`MF_ENRICH_HTTP_RETRIES`/`MF_ENRICH_HTTP_BACKOFF` for the NAV provider's own, so a slow or unreachable third-party source cannot slow down or fail a NAV ingest. `fetch_or_reason()` turns any such failure into `EnrichReason.SOURCE_UNREACHABLE` instead of letting the exception reach a page.

### `scheme_attributes` (T3.2)

One row per scheme code (key: `scheme_code`), keyed to the current fetch rather than a history: `riskometer`, `riskometer_as_of` (its own month, separately staleness-checked at 31 days rather than the general `MF_ENRICH_STALE_DAYS`, because SEBI mandates a monthly disclosure), `exit_load_pct`, `exit_load_period_days`, `lock_in_days`, `min_investment`, `min_sip`, `benchmark_name`, `fund_manager`, `manager_start_date`, plus the four provenance columns every enrichment table carries.
`manager_tenure_years` is not a column: `manager_tenure_years()` derives it from `manager_start_date` at query time on every read, so tenure never sits in storage as a number that ages between fetches.
Defined and registered in `packages/analytics/src/mf_analytics/enrich/attributes.py`; served by `GET /schemes/{scheme_code}/attributes`, and by `GET /screen`'s `exit_load_pct_max`/`manager_tenure_years_min` query parameters, both in `apps/api/mf_api/main.py`.
The screener filter (`exit_load_pct_max`/`manager_tenure_years_min`) is applied to the result of `run_screen`/`run_export` rather than through SQL, since those functions query only `SORTABLE`/`NUMERIC_BY_NAME` columns and read no request-supplied filter beyond that whitelist.
`riskometer`, `exit_load_pct`, `exit_load_period_days`, `lock_in_days`, `min_investment`, `min_sip`, `benchmark_name`, `fund_manager` and `manager_tenure_years` are, separately, selectable and sortable columns on `GET /screen` and `GET /export`: `screen_base` (`apps/api/mf_api/store.py`) `LEFT JOIN`s `scheme_attributes` the same way it already `LEFT JOIN`s `scheme_ter` for `expense_ratio`, and `manager_tenure_years` is a `date_diff(...)/365.25` expression in that view rather than a stored column, so it is never stale between fetches.
This join reaches `screen_base`, a read-only view over `scheme_metrics_snapshot` - not `scheme_metrics_snapshot` itself, a ranking, or a risk computation - so the T3.1 fence (enforced by `assert_disjoint_from_snapshot` against the real table schema) is unaffected.

### `scheme_holdings` (T3.3)

One row per instrument per scheme per disclosure month. Key: `(scheme_code, as_of, instrument_key)`.

| Column                                             | Meaning                                                                                                                      |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `scheme_code`                                      | The fund, joined to `scheme_master`; a code absent from it is refused at import.                                             |
| `as_of`                                            | The disclosure month, collapsed to its month end. Provenance column, and part of the key.                                    |
| `instrument_key`                                   | What a holding is matched on across funds and months: `instrument_id` when the file carries one, `instrument_name` when not. |
| `instrument_id`                                    | The published identifier (ISIN or similar), nullable.                                                                        |
| `instrument_name`                                  | Required and never blank.                                                                                                    |
| `weight`                                           | **Fraction of net assets, never a percentage.** 4.5% of the portfolio is `0.045`.                                            |
| `quantity`, `market_value`, `sector`, `asset_type` | All nullable. `asset_type` is one of `equity`, `debt`, `cash`, `derivative`.                                                 |
| `source`, `source_url`, `fetched_at`               | The remaining three provenance columns, `NOT NULL` like every enrichment table's.                                            |

`instrument_key` exists because a primary key column cannot be null while `instrument_id` legitimately can: a file with no identifiers still imports, matched by name, and the import warns that it will only overlap against another fund naming the same instrument identically.

Defined and registered in `packages/analytics/src/mf_analytics/enrich/holdings.py`; the CSV contract that is the only way rows reach it is in `holdings_csv.py` and documented in `README.md`. Loaded by `make holdings-import`, checked by `make holdings-validate`, and served by `GET /schemes/{code}/holdings`, `GET /schemes/{code}/holdings/turnover` and `GET /overlap`.

Unlike `scheme_attributes`, this table is **not** joined into `screen_base`, so nothing in it is a selectable, sortable or filterable screener column. A weight is a portfolio fact about one month; a screener column is something a fund gets ranked by, and holdings may never be that. `tests/test_enrich.py` asserts both that its columns are disjoint from `scheme_metrics_snapshot` and that its name does not appear in the screening view.

Derived at query time, never stored:

- **Concentration**: holding count, total disclosed weight, and the top-10 share of the latest month.
- **Sector and asset-type allocation**: weight grouped by `sector` and by `asset_type`, each with an explicit unclassified bucket rather than a dropped row, so a split never quietly sums to less than the portfolio does.
- **Turnover**: between consecutive disclosure months, half the sum of absolute weight changes over the union of instruments - the same convention `style_drift_3y` uses, so 0 is an unchanged portfolio and 1 a complete replacement. Below two months it is null with `insufficient_holdings_months`.
- **Overlap**: per pair of funds, the sum of the minimum weight per shared instrument, as a percentage. Refused with `holdings_as_of_months_differ` when the two funds' latest months are more than one month apart, because the difference would then be trading rather than positioning.
- **Cross-check against returns-based exposure**: the holdings' equity share against whether the (all-equity, Indian) style basis explains the fund's NAV. A portfolio over the 65% equity line that the basis cannot explain, or one under it that the basis explains well, sets `cross_check.diverges`. Both readings are always returned; the disagreement is information, not an error to resolve.

Named reasons this table can emit: `holdings_not_loaded`, `insufficient_holdings_months`, `holdings_as_of_months_differ`, `holdings_asset_type_not_supplied`, plus the shared `enrichment_source_unreachable` from the dormant fetch adapter.
