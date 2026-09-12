# Data-source and scope policy

This is the policy the code actually implements.
It supersedes the earlier "TigZig only for v1" draft, which was written before the benchmark and expense-ratio work landed.
Where the two disagree, this file is right and the reasons are given below.

## Sources

TigZig's free AMFI NAV API is the primary source and the only one that returns and risk metrics are computed from.

| Purpose               | Source                                                              | Configured as                               |
| --------------------- | ------------------------------------------------------------------- | ------------------------------------------- |
| Scheme master         | `https://api.tigzig.com/mf/v1/download?format=latest.parquet`       | `MF_API_BASE`, `MF_MASTER_FORMAT`           |
| Full NAV history      | `https://api.tigzig.com/mf/v1/download?format=parquet`              | `MF_API_BASE`, `MF_NAV_FORMAT`              |
| Source schema         | `https://api.tigzig.com/mf/v1/openapi.json` and `/mf/v1/` (catalog) | `MF_API_BASE`                               |
| Download manifest     | `https://api.tigzig.com/mf/v1/downloads/manifest`                   | `MF_API_BASE`                               |
| Expense ratio         | A CSV of AMFI's per-AMC TER disclosures                             | `MF_TER_CSV_URL`                            |
| Benchmark index level | A total-return CSV you supply, or a labelled index-fund proxy       | `make benchmark-import` / `benchmark-proxy` |

The format values are the provider's own, read from its manifest: `parquet` for the full history and `latest.parquet` for the master.
There is no bare `latest` format; the manifest offers `latest.csv`, `latest.csv.gz`, `latest.csv.zip` and `latest.parquet`.

Not used, and not to be added: AMFI scraping, MFAPI, Tickertape, Value Research, paid APIs, or browser automation to collect investment data.
The MFAPI adapter that once existed has been deleted - nothing called it, and a fallback nothing exercises is a fallback that does not work.

### Portfolio holdings: the engine is built, the source is not depended on

No holdings source is wired into this app today, and none will be until the rules below are satisfied.
The earlier version of this section concluded that no usable source existed at all; that conclusion is no longer complete.

TigZig's MF API exposes seven endpoints - catalog, search, nav, `schemes/{code}/nav`, download, downloads/manifest and terms - and carries NAV and the scheme master only.
Every other API in the TigZig catalog was checked too; the Yahoo Finance one there returns who owns a _stock_, not what a fund owns.

AMFI publishes no holdings at all.
Its sitemap lists thirteen pages, none of them a portfolio disclosure, and the word "portfolio" does not appear on its research-information page.
SEBI requires each AMC to publish its own monthly portfolio on its own website, and there is no consolidated file anywhere.

That leaves roughly forty-four AMC sites, each with its own URL scheme and its own spreadsheet layout, both changing without notice.
They are also actively hostile to automated collection: HDFC's disclosure page answers a plain request with `403`.
Getting past that is browser automation to collect investment data, which is the one thing this policy names and refuses, and buying past it with a paid API is refused for the same reason.

The candidate is `mfdata.in`, a free, no-authentication REST API that claims stock-level holdings, sector allocation and ratios across 14,000+ schemes.
It is third party, not an authoritative regulatory filing, and it has never once answered.
Probed read-only on 2026-09-09 at `https://mfdata.in/docs`, it returned HTTP 522, meaning its origin was down.
Re-probed read-only on 2026-09-12 at `/`, `/docs` and `/openapi.json`, it returned HTTP 522 on all three - the same failure, three days later.
A source that has never once responded cannot be depended on, and this project does not depend on it: nothing fetches from it, no pipeline step and no `make` target reaches for it, and no holdings data ships.

What T3.3 ships instead is the engine plus a strict import contract, which is exactly the pattern that already works here for benchmark index series (`make benchmark-import` / `benchmark-validate`, and `ingest/benchmarks.py`).
The operator supplies a holdings file from a source they legitimately have, `make holdings-validate` checks it against the contract, and `make holdings-import` loads it.
See the holdings CSV contract in `README.md` for the columns and every rejection.
`packages/analytics/src/mf_analytics/enrich/holdings.py` also carries a **dormant** adapter, `fetch_scheme_holdings`, wired to the enrichment timeout/retry budget and returning `enrichment_source_unreachable` on failure.
Nothing calls it - a test asserts that no file under `packages/`, `apps/api/` or the `Makefile` does - and it exists only so that the day the source becomes reliably available, wiring it in is one call rather than a rewrite.

So holdings are admitted only as an enrichment tier, never as a return, risk or ranking input, under the rules T3.1 sets before any enrichment source is wired in: every row carries `source`, `source_url`, `fetched_at` and `as_of`; no enrichment column is ever read into `scheme_metrics_snapshot`, a ranking or a risk computation; an unreachable source produces a named-reason null across the dependent UI, never an error page or a stale value shown as current; and past a staleness threshold the UI labels the value as stale with its `as_of` date.
Unlike `scheme_attributes`, `scheme_holdings` is deliberately **not** joined into the `screen_base` view either, so no holding, sector or weight is a screener column: a weight is a portfolio fact about one month, and a screener column is something a fund gets ranked by.
`tests/test_enrich.py` asserts both halves of that.
Where holdings do exist, the fund's returns-based style exposure is reported alongside them and a divergence between the two readings is flagged rather than resolved - see the returns-based exposure section below, and `GET /schemes/{code}/holdings`.

T3.1 builds that fence before either source lands: `packages/analytics/src/mf_analytics/enrich/` is the only place an enrichment table's schema may be declared, provenance is added automatically rather than left to each table author, and a test (`tests/test_enrich.py`) asserts the fence holds by importing the real `scheme_metrics_snapshot` column list rather than a hand-maintained copy.
The staleness threshold and the enrichment source's own timeout/retry/backoff budget - deliberately smaller than the NAV provider's, so a flaky third-party source cannot slow down or fail a NAV ingest - live in `.env` as `MF_ENRICH_STALE_DAYS`, `MF_ENRICH_HTTP_TIMEOUT`, `MF_ENRICH_HTTP_RETRIES` and `MF_ENRICH_HTTP_BACKOFF`.
`make validate` reports enrichment coverage and staleness per table alongside the existing checks, through `cli.py`'s `validate` command calling `EnrichmentRegistry.coverage_and_staleness`.

### Scheme attributes (T3.2): riskometer, exit load, lock-in, minimums, manager

`scheme_attributes` is the first table registered on the T3.1 fence, in `packages/analytics/src/mf_analytics/enrich/attributes.py`.
It carries the riskometer and its own `as_of` month, exit load and its period, lock-in period, minimum investment, minimum SIP, the benchmark named in the scheme information document, the fund manager, and the manager's start date.
The candidate source is the same `mfdata.in` evaluated above for holdings, probed unreachable on first contact; every fetch failure resolves to `enrichment_source_unreachable` and every field the source does not carry resolves to `enrichment_source_does_not_carry_this_fund`, both named on `/schemes/{code}/attributes` rather than shown as a bare dash.
The riskometer gets its own, stricter staleness rule than the general `MF_ENRICH_STALE_DAYS`: SEBI mandates a monthly disclosure, so a riskometer value older than 31 days is labelled `enrichment_value_stale` regardless of the general threshold.
Manager tenure is never stored: `manager_tenure_years` is computed from `manager_start_date` at query time on every read, so it cannot silently age the way a persisted number would.
These fields are screener filters (`exit_load_pct_max`, `manager_tenure_years_min` on `GET /screen`), because they decide a shortlist, but the filter is applied to the screen's already-computed result set from the API layer rather than by joining `scheme_attributes` into the `scheme_metrics_snapshot` query - the T3.1 fence forbids an enrichment column from ever reaching that query, a ranking, or a risk computation.
T1.2's after-tax-and-load figure reads `exit_load_pct` and `exit_load_period_days` off this table when present; a scheme with no row still returns `exit_load_not_published`, never a load assumed to be zero.

### Why TER is a second source

AMFI mandates daily TER disclosure but serves it per AMC behind a form, so there is no consolidated feed to read.
`MF_TER_CSV_URL` points at a scrape of those pages and covers part of the industry, not all of it.
It is join-only: it never enters a return, a risk metric or a ranking, and a fund the source does not carry shows a blank carrying the reason `ter_not_published`, never a zero.
Returns are already net of expenses, so TER is there for cost comparison and is never subtracted again.

### Why benchmarks are in

The draft deferred every benchmark-relative metric to v2 and asked that the schema be built so a provider could be added later.
The schema was built that way and the provider was then added, so the deferral no longer describes the code.
Benchmark data still ships empty: no index series is bundled, and every benchmark-relative metric is null with a named reason until someone imports one.
That is the important property the draft was protecting, and it holds.

Three reasons are distinguished, so a blank never reads as "no data loaded yet" when it is a deliberate refusal:

- `benchmark_not_mapped` - the fund's sub-category has no benchmark configured.
- `benchmark_unavailable` - a benchmark is mapped but no index series covers the period.
- `benchmark_currency_mismatch` - the mapped index is not in INR, so comparing it to a rupee NAV would measure the exchange rate as well as performance.

## Canonical tables

`scheme_master`, `nav_daily` (a view over the year-partitioned Parquet lake), `nav_monthly`, `monthly_returns`, `rolling_returns_monthly`, `category_monthly_returns`, `category_metrics_snapshot`, `scheme_metrics_snapshot`, `benchmarks`, `scheme_benchmark_map`, `scheme_ter`, `nav_zero_excluded`, `ingest_log`, `raw_file`.
Enrichment tables (`scheme_attributes` and `scheme_holdings`) are listed separately above, under the T3.1 fence, because none of them may ever be read into a return, risk or ranking query the way this list's tables are.

Two names differ from the draft.
`ingest_log` is the draft's `ingestion_metadata`, and `raw_file` holds the per-artefact provenance - source URL, SHA-256, byte count, ETag, file and manifest row counts, download and ingest timestamps.
Data-quality flags are a JSON column on `scheme_metrics_snapshot` rather than a table of their own: they are wholly derived from the snapshot they sit in, and a separate table would be a second thing to keep in step with it.

There are no `scheme_master_raw` or `nav_daily_raw` tables.
The raw artefact is kept as the downloaded file itself under `data/raw/`, with a `.meta.json` sidecar and a `raw_file` row, which is a truer record of what arrived than a re-typed copy in the database.

## Engineering rules

Every external URL, timeout, retry limit and download format lives in `.env`.
No field name is guessed: `make inspect` reads the live OpenAPI spec, catalog and manifest, prints the source columns beside the canonical mapping, and saves the whole thing with example rows to `data/raw/source_inspection.json`.
A NAV file missing a required column raises `SchemaMismatchError` rather than mapping it to null.

Bulk ingestion never materialises the history in pandas.
DuckDB scans the source Parquet and writes the partitioned lake in one streaming `COPY ... PARTITION_BY (year)`, and the daily-NAV drawdown runs as SQL over the lake for the same reason.

## Style box and returns-based exposure

Two things describe what a fund invests in, and they are deliberately different in kind.

`cap_band` and `style` on `scheme_master` are the **declared mandate**, derived in `classify.py` from the SEBI sub-category and, only where that carries no band, from the scheme's own name.
They say what the fund says it does.
A holdings-based style box needs the price-to-book and price-to-earnings of the portfolio, which nobody publishes, so no such box is offered.
`style` has no Growth value for the same reason: separating growth from blend is a holdings measurement, and inferring it from a name would be a guess.

`/schemes/{code}/exposure` is the **measured behaviour**, fitted by returns-based style analysis: the long-only mix of index returns whose monthly returns best explain the fund's own, with weights at or above zero summing to one.
The basis is seven index-fund proxies built by `make style-basis` from funds already in the NAV data, so it needs no new source.
Momentum and Value are absent from the basis on purpose: their trackers began in 2023-24, and either would cut the shared fit window below the 24 months every other risk metric here requires.

The fit is refused rather than reported when it explains less than half of the fund's movement, carrying `style_basis_does_not_describe_this_fund`.
That is the correct answer for a fund holding gold, debt, or anything outside India, and it is what the Motilal Oswal S&P 500 fund returns.

Neither field is a holdings statement.
Two funds owning entirely different stocks with the same size and sector tilt are indistinguishable to the exposure fit.

## Default analysis universe

Active, Direct, Growth, compared within `clean_sub_category`, equal-weighted, leave-one-out, at least five eligible peers, NAV above zero, enough month-end history for the metric asked for.

Overridable: active-only vs all, Direct-only vs Direct + Regular vs all, Growth-only vs all, sub-category vs category, mean vs median, leave-one-out vs include-self.
The screener's filters cover plan, option and active; the full universe methodology can be varied per fund on `/schemes/{code}/comparison`.
Screener columns come from the stored snapshot and therefore always use the default universe - the API says so in the `methodology.note` it returns with every screen.

## Metrics

Trailing CAGR at 1, 3, 5 and 10 years.

Rolling CAGR at 1, 3, 5 and 10 years, persisted month by month in `rolling_returns_monthly`, summarised as mean, median, minimum, maximum, standard deviation, percentage of positive windows, percentage of windows beating the sub-category and the peer benchmark, and the window count.

`/schemes/{code}/rolling-returns` takes any horizon from 1 to 15 and computes it live through the same `rolling_cagr` on the same comparable grid, so a chart is never limited to the four stored horizons and can never disagree with them.

Sub-category comparison at 3, 5 and 10 years: peer CAGR, fund minus peer in percentage points, fund over peer where the denominator is positive, and the eligible peer count.

Risk from monthly returns at 3, 5 and 10 years: annualised volatility, Sharpe, Sortino, downside deviation, Calmar, and Information Ratio against the leave-one-out sub-category return, as `mean(active) / std(active) * sqrt(12)`.
Maximum drawdown is measured on daily NAV, not the month-end grid, because a month-end grid steps straight over a trough.

Benchmark-relative metrics at 3, 5 and 10 years, all null until an index is imported: benchmark CAGR, excess return, Information Ratio, tracking error, alpha, beta, R-squared and rolling outperformance.

## Data-quality policy

A NAV of zero never enters a return: those rows are dropped at ingest and the schemes they belonged to are recorded in `nav_zero_excluded` and flagged `terminal_zero_nav_excluded`.
Inactive and matured schemes stay in the raw data and are excluded from the default screen.
Missing or inconsistent category, plan and option fields are flagged.
Insufficient history is flagged per horizon, at fewer than 12, 36, 60 and 120 month-end observations.
NAV gaps are flagged and never forward-filled.
A NAV scale break - a redenomination filed as a raw jump - truncates the comparable history at the break rather than rescaling it, and is flagged.
A young scheme among long-lived peers is flagged `possible_merger_or_rebrand`.

AUM is quarterly average AUM for one exact scheme variant.
It is labelled `Scheme AAUM (Quarterly Average, ₹ Cr)`, never "Current AUM", and Direct/Regular or Growth/IDCW variants are never summed, because no validated scheme-family mapping exists.

## UI requirements

Every screen carries the data source, the disclaimer, a methodology link, and the calculation as-of date.
NAV coverage, the ingest log and the metrics as-of date are on the dashboard.
Every null metric shows the reason it is null, in words, from `/columns`.

## Holdings source gate (T3.3): the source failed the gate, the engine shipped anyway

The plan gated T3.3 on the candidate source being observed available across a week of scheduled checks.
It has not been available once.
A read-only probe on 2026-09-09 ran four checks against `https://mfdata.in`: three requests to `/docs` returned `522`, `522`, and a client-side timeout with no response, and one request to `/` returned `522`.
A read-only re-probe on 2026-09-12 checked `/`, `/docs` and `/openapi.json` and got `522` from all three.
The source has therefore never once answered, and the question of whether its response would carry stock-level holdings has never been reached.

The plan's instruction for that outcome was to stop and say so here rather than build on the source, and that is what has happened: **no holdings data ships, and nothing fetches from that source.**
What did ship is the part that does not depend on it - `scheme_holdings`, the import contract, the derived reads, and the endpoints - on the same operator-supplied-file model this project already uses for benchmark index series, where no index data ships either.

Built:

- `packages/analytics/src/mf_analytics/enrich/holdings.py` and `holdings_csv.py`: the `scheme_holdings` table registered on the T3.1 fence, the CSV contract, concentration, sector and asset-type splits, turnover, and pairwise overlap.
- `make holdings-validate FILE=...` and `make holdings-import FILE=...`.
- `GET /schemes/{code}/holdings`, `GET /schemes/{code}/holdings/turnover`, `GET /overlap?codes=A,B[,C,D,E]`, each returning a named reason rather than an error when the store carries nothing.
- A dormant `fetch_scheme_holdings` adapter, called by nothing, asserted to be called by nothing.

Not built, deliberately: any fetch from an AMC site, any browser automation, any paid API, and any scheduled fetch from `mfdata.in`.
`apps/web/src/app/overlap/` is still not built.
This entry should be revisited only if the candidate source starts answering across a week of scheduled checks - and even then, only the dormant adapter changes, because the import contract and everything derived from it are already the shipped path.
