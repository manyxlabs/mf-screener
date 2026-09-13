# API reference

The service is self-documenting: OpenAPI JSON at `/openapi.json`, Swagger UI at `/docs`, ReDoc at `/redoc`.
This page covers the parts a generated page cannot explain well.

## Endpoints

| Method | Path                                 | Purpose                                                                                            |
| ------ | ------------------------------------ | -------------------------------------------------------------------------------------------------- |
| GET    | `/health`                            | Liveness plus the number of schemes loaded                                                         |
| GET    | `/metadata`                          | Row counts, NAV coverage, benchmark coverage, recent pipeline runs                                 |
| GET    | `/benchmarks`                        | Loaded series, mapping rules, coverage gaps and currency policy                                    |
| GET    | `/methodology`                       | The full machine-readable methodology, including LaTeX formulas                                    |
| GET    | `/columns`                           | Column vocabulary: selectable, sortable, metric definitions, missing-data reasons                  |
| GET    | `/presets`, `/presets/{id}`          | Preset screens                                                                                     |
| GET    | `/search`                            | Typeahead over scheme name and AMC, fts-backed                                                     |
| GET    | `/schemes`                           | Scheme master browse and pagination (`q` is a plain substring, not the typeahead)                  |
| GET    | `/schemes/{code}`                    | One scheme, its mapped benchmark and comparability, and its `category_history`                     |
| GET    | `/schemes/{code}/nav`                | NAV series, `frequency=daily\|monthly`                                                             |
| GET    | `/schemes/{code}/metrics`            | The stored snapshot row, with missing reasons expanded                                             |
| GET    | `/schemes/{code}/rolling-returns`    | Rolling series, its summary, and the peer series                                                   |
| GET    | `/schemes/{code}/net-returns`        | Gross, after-tax and after-tax-and-load return for one horizon and mode                            |
| GET    | `/schemes/{code}/comparison`         | Peer comparison recomputed live for chosen universe toggles                                        |
| GET    | `/schemes/{code}/exposure`           | Style-factor fit, once over the whole history or rolling with `rolling=true`                       |
| GET    | `/schemes/{code}/attributes`         | Riskometer, exit load, lock-in, minimums, SID benchmark, manager and tenure (enrichment)           |
| GET    | `/schemes/{code}/holdings`           | The latest disclosed portfolio, its splits, and the returns-based exposure beside it               |
| GET    | `/schemes/{code}/holdings/turnover`  | Turnover between consecutive disclosure months                                                     |
| GET    | `/overlap`                           | Pairwise portfolio overlap for 2 to 5 scheme codes                                                 |
| GET    | `/score/{code}`                      | Composite score: weighted sub-category percentile, component by component                          |
| GET    | `/categories`                        | Sub-category counts                                                                                |
| GET    | `/categories/{category_key}/metrics` | Category snapshot, its monthly return series, and the active-only vs. all-schemes survivorship gap |
| GET    | `/screen`                            | The screener query                                                                                 |
| GET    | `/export/csv`                        | The same query as CSV, with a methodology header                                                   |
| POST   | `/basket`                            | Correlation matrix and blended risk/return for up to 10 hand-picked funds                          |
| POST   | `/admin/refresh`                     | Run one pipeline step as a subprocess                                                              |
| POST   | `/admin/import-benchmark`            | Validate and import a benchmark CSV from under the data directory                                  |
| POST   | `/admin/validate-benchmark`          | Check a benchmark CSV against the import contract without writing anything                         |

## `GET /search`

Backs the header typeahead across all 38k schemes, not a `LIKE` scan.

`scheme_master` carries a generated `search_text` column - every word of the scheme
name and AMC, plus every prefix of each word from length 2 up - indexed with DuckDB's
`fts` extension (`PRAGMA create_fts_index`, rebuilt as part of schema init). Plain FTS
only matches whole tokens, which would miss the fund while the user is still typing
"flexi" as "fle"; indexing prefixes as separate terms lets `match_bm25` rank a partial
word the same way it ranks a complete one.

`q` is required (non-empty) and `limit` defaults to 10, max 25. Each result carries
`clean_plan` and `clean_option`, because the same fund is still one row per plan and
option variant until T2.1 groups them. A query that matches nothing returns
`{"items": []}` rather than an error, so the frontend can render an empty state
instead of treating it as a failure.

## `GET /screen`

Paging, sorting, search and filters in one call.

```
/screen?page=1&page_size=50
       &sort=rolling_5y_median:desc,sharpe_5y:desc
       &columns=scheme_name,cagr_5y,rolling_5y_median,sharpe_5y
       &sub_category=Mid+Cap+Fund&plan=Direct&option=Growth&active_only=true
       &cagr_5y_min=0.12&fund_minus_category_5y_min=0&max_drawdown_5y_min=-0.35
```

**Sorting** is `column:direction`, comma-separated, applied in order.
Nulls always sort last in both directions: a missing metric must never win a ranking.
`scheme_code` is appended as the final tiebreaker so pagination is stable.

**Filters** are repeated query parameters (`sub_category=A&sub_category=B` means A or B; different parameters are ANDed).

**Numeric ranges** are `<metric>_min` and `<metric>_max` for any metric in `/columns`.
Values are decimals, not percentages: `cagr_5y_min=0.12` is 12%.
An unrecognised metric name is a 400 rather than a silently ignored parameter, so a typo in a saved screen cannot quietly widen the result set.

**The `methodology` block** in every response records the snapshot date, the version, the peer universe, the risk-free rate, and the filters and sort that were actually applied.
`/export/csv` writes the same information into comment lines above the header.

### Safety

Client strings never reach SQL.
A column name selects an entry from a whitelist built at import time (`apps/api/mf_api/columns.py`); every value is bound as a parameter.
The service holds a read-only DuckDB connection, so no request can write to the store.

## `GET /schemes/{code}/net-returns`

```
/schemes/119551/net-returns?horizon=5&mode=lumpsum
```

`horizon` is 1-15 years (default 5); `mode` is `lumpsum` (default) or `sip`.
This is a display layer computed over the existing gross return - it is never stored, never a snapshot column, and never something a screen can sort or filter on, because the applicable rate depends on who holds the fund, not on the fund itself.

Orientation for capital gains tax - `equity_oriented` or `debt_oriented` - is read off `clean_category` and `clean_sub_category`, never guessed: a Hybrid sub-category whose SEBI mandate lets the equity share float across the 65% line (Balanced Advantage, Dynamic Asset Allocation, Multi Asset Allocation) returns `orientation: null` and both the tax and tax-and-load figures come back null with reason `tax_treatment_undetermined`.

`after_tax_and_load_return` is always null with reason `exit_load_not_published` - exit load is not a stored field yet (T3.2 adds it) and is never assumed to be zero.

Every rate - `ltcg_rate`, `ltcg_exemption`, `stcg_rate`, `lt_holding_months`, `slab_rate` - is echoed back in `assumptions`, read from `.env` so a rate change is a config change. `assumptions.slab_rate_note` states plainly that the slab rate is an assumption about the holder's tax bracket, not a property of the fund.

## `GET /schemes/{code}/comparison`

The stored snapshot only covers the default peer universe.
This endpoint recomputes peer metrics live for one fund under any combination of `level`, `plan_scope`, `option_scope`, `active_only`, `aggregation` and `exclude_self`.
That is cheap for one fund and its peers, and it is what the toggles on the fund page call.

## `GET /schemes/{code}/behaviour`

Drawdown episodes, calendar-year returns and cost are computed live from stored NAV.

Capture is the exception: `capture_by_horizon` carries the snapshot's `upside_capture_{h}y` and `downside_capture_{h}y` for each horizon in `CAPTURE_HORIZONS`, and `capture` repeats the shortest of them with its `horizon_years` named.
`capture_peer_basis` is always `leave_one_out_category_average`.
Serving the stored columns is what keeps this endpoint and the screener showing the same number for the same fund; computing it here a second time meant the endpoint measured the fund against the whole category including itself, over its whole history, while the snapshot used a leave-one-out average over a fixed window.
Capture needs two years of paired months, so a fund too young for a snapshot row could never have produced one here either; it is null with a named reason instead.

## `GET /schemes/{code}/exposure`

Returns-based style analysis, never a holdings statement: the long-only mix of the style-factor basis that best explains the fund's own monthly returns.
With no query parameter, one fit over the whole shared history.

With `rolling=true`, the same fit refit on every trailing 36-month window, stepped one month at a time:

```json
{
  "window_months": 36,
  "points": [
    { "end_date": "2023-05-31", "r_squared": 0.87, "months": 36, "weights": [...], "reason": null },
    { "end_date": "2023-06-30", "r_squared": 0.41, "months": 36, "weights": null, "reason": "style_basis_does_not_describe_this_fund" }
  ],
  "style_drift_3y": { "value": 0.04, "n_obs": 11, "reason": null }
}
```

A window whose R-squared falls below the same floor the single fit uses is dropped from `points` with its `reason` (`weights: null`) rather than repeating the previous window's mix - there is no carry-forward.
`style_drift_3y` is the mean turnover (half the sum of absolute weight changes across the basis) between consecutive windows ending in the last 3 years; it needs at least 2 such windows or it is null with `insufficient_rolling_windows`.
The same scalar is also stored on the snapshot (`GET /schemes/{code}/metrics`), so a screen can sort or filter on it.

## `GET /schemes/{code}/holdings`

The latest disclosed portfolio for one fund, plus everything derived from it.

This project ships no holdings data and fetches none - see `docs/data-policy.md` - so every row served here was imported from a file the operator supplied to `make holdings-import`. A fund the store carries nothing for returns `200` with `as_of: null` and `reason: "holdings_not_loaded"`, never an error page.

```json
{
  "as_of": "2026-06-30",
  "as_of_month": "2026-06",
  "months_available": ["2026-05-31", "2026-06-30"],
  "stale": false,
  "holdings_count": 3,
  "weight_sum": 1.0,
  "top_10_concentration": 1.0,
  "holdings": [
    {
      "instrument_id": "INE001",
      "instrument_name": "Alpha Ltd",
      "weight": 0.4,
      "quantity": null,
      "market_value": null,
      "sector": "Financials",
      "asset_type": "equity"
    }
  ],
  "sector_allocation": [{ "sector": "Financials", "weight": 0.4 }],
  "asset_type_split": [{ "asset_type": "equity", "weight": 1.0 }],
  "returns_based_exposure": {
    "weights": [],
    "r_squared": null,
    "months": 0,
    "reason": "benchmark_unavailable"
  },
  "cross_check": {
    "holdings_equity_share": 1.0,
    "style_basis_explains_this_fund": false,
    "diverges": true,
    "reason": null,
    "note": "..."
  }
}
```

`as_of` is stated on every response and repeated as `as_of_month`, because holdings are a month-old photograph and the fund can have traded since. `stale` compares that month against `MF_ENRICH_STALE_DAYS`.

`holdings` is sorted by weight, heaviest first. `sector_allocation` and `asset_type_split` keep an explicit `null` bucket for anything the file did not classify, rather than dropping the row, so a split never quietly sums to less than the portfolio does.

`returns_based_exposure` is the same fit `GET /schemes/{code}/exposure` returns, served here so the two readings of the fund sit side by side. `cross_check.diverges` is true when the portfolio is at or above 65% equity and the style basis cannot explain the fund's NAV, or below 65% and it can. **Both readings are always returned** - the disagreement is information about a fund that has traded since the filing, or one the all-equity Indian basis does not cover, and hiding either would throw that away. When the imported file carried no `asset_type`, `diverges` is `null` with `reason: "holdings_asset_type_not_supplied"`.

## `GET /schemes/{code}/holdings/turnover`

```json
{
  "months_available": ["2026-05-31", "2026-06-30"],
  "points": [{ "from_as_of": "2026-05-31", "to_as_of": "2026-06-30", "turnover": 0.3 }],
  "latest": { "from_as_of": "2026-05-31", "to_as_of": "2026-06-30", "turnover": 0.3 },
  "reason": null
}
```

Half the sum of absolute weight changes between consecutive disclosure months, over the union of instruments in the two - the same convention `style_drift_3y` uses, so 0 is an unchanged portfolio and 1 a complete replacement. Below two stored months the points list is empty with `reason: "insufficient_holdings_months"`; with no holdings at all, `holdings_not_loaded`. Consecutive means as filed, not as dated: a gap in the disclosures is diffed across, and each point's two dates say how far apart it is.

## `GET /overlap`

```
/overlap?codes=119551,120503
```

Two to five comma-separated scheme codes, no repeats; anything else is `422`. An unknown scheme code is `404`.

```json
{
  "codes": ["S01", "S02"],
  "funds": [
    {
      "scheme_code": "S01",
      "scheme_name": "...",
      "as_of": "2026-06-30",
      "as_of_month": "2026-06",
      "holdings_count": 3,
      "stale": false,
      "reason": null
    }
  ],
  "pairs": [
    {
      "scheme_code_a": "S01",
      "scheme_code_b": "S02",
      "as_of_a": "2026-06-30",
      "as_of_b": "2026-06-30",
      "overlap_pct": 50.0,
      "shared_instruments": [
        {
          "instrument_key": "INE002",
          "instrument_name": "Beta Ltd",
          "weight_a": 0.3,
          "weight_b": 0.5,
          "min_weight": 0.3
        }
      ],
      "reason": null
    }
  ],
  "max_as_of_gap_months": 1
}
```

`overlap_pct` is the sum of the minimum weight per shared instrument, as a percentage of net assets: two funds holding identical portfolios overlap 100%, two holding nothing in common 0%.

Each fund's own as-of month is stated, and **a pair whose two months are more than one month apart is refused** with `overlap_pct: null` and `reason: "holdings_as_of_months_differ"`. Comparing a January portfolio with a June one measures five months of trading, not a difference in positioning. A fund the store carries no holdings for gets `holdings_not_loaded` on its own row and on every pair it appears in, rather than dropping out of the response.

Instruments are matched on `instrument_key` - the published identifier where the imported file carried one, the instrument name where it did not - so two funds whose files identify the same stock differently will not match it. The import warns when a file has no identifiers, for exactly this reason.

## `GET /score/{code}`

A weighted percentile score against the fund's own `peer_group` peers - never a rating or a recommendation, a decomposition the caller can read component by component.

The same number is available as the `score` screener column (with `score_coverage`), stored by `metrics-build` so it can be sorted and ranged on; this endpoint is the decomposition behind it.

The peer group is the sub-category refined by what the fund actually holds (see `docs/data-model.md#peer-groups`).
SEBI files a fund by its legal wrapper, so the raw sub-category ranks a Nasdaq feeder against gold and bond funds; `peer_group` does not.
Where the refinement leaves too few peers to rank against, the components come back with `insufficient_peer_universe` rather than a percentile computed against funds that were never alternatives.

```json
{
  "scheme_code": "S01",
  "total": 65.0,
  "status": "partial",
  "missing_components": ["index_skill"],
  "coverage": 0.85,
  "reason": null,
  "reason_description": null,
  "weights": {
    "peer_excess": 0.3,
    "consistency": 0.2,
    "risk_adjusted_return": 0.2,
    "steadiness": 0.15,
    "index_skill": 0.15
  },
  "components": {
    "peer_excess": {
      "weight": 0.3,
      "percentile": 1.0,
      "contribution": 35.3,
      "reason": null,
      "reason_description": null,
      "horizons": ["3y", "5y"]
    },
    "index_skill": {
      "weight": 0.15,
      "percentile": null,
      "contribution": null,
      "reason": "insufficient_peer_universe",
      "reason_description": "Too few eligible peer schemes in the sub-category for this horizon.",
      "horizons": []
    }
  },
  "peer_group": "Mid Cap Fund · India Equity · Mid Cap",
  "peer_count": 5,
  "disclaimer": "..."
}
```

`weights` is the whole declared table (see `docs/data-model.md#composite-score`), echoed on every response - there is no hidden weighting.
Every component blends the 3-, 5- and 10-year reading of its metric; `horizons` names the ones that actually fed the percentile, so a young fund's score says on its face that it was formed on three years.
A fund missing a component is scored on the components it has: `status` is `"partial"`, `missing_components` names which did not count, and both the horizon blend and `total` renormalise over the weight present - which is why a contribution can exceed `weight * 100`.
`coverage` is the share of the weight table the fund answered; below 0.5 `total` is null with `reason` `coverage_below_floor` and only the components are returned.
404 when the scheme is unknown or has no metrics snapshot row, with the same reason `GET /schemes/{code}/metrics` would give.

## `GET /categories/{category_key}/metrics`

`category_key` is `PeerUniverse.category_key(value)`, where `value` is the `peer_group` label: `sub_category=<value>|plan=<plan_scope>|option=<option_scope>|active=<y|n>|agg=<mean|median>` (or `category=` at the category level). The `active=y`/`active=n` marker is the only difference between the two keys that name the same peer group under active-only and all-schemes universes.

T2.4: every category aggregate is computed over both universes and stored under its own key, so this endpoint always returns both sides of the pair alongside the row for the key that was asked for:

```json
{
  "category_key": "sub_category=Small Cap Fund · India Equity · Small Cap|plan=direct|option=growth|active=y|agg=mean",
  "cagr_1y": 0.0627,
  "cagr_3y": 0.1451,
  "cagr_5y": 0.1201,
  "cagr_10y": 0.1894,
  "eligible_scheme_count": 3,
  "monthly_returns": [
    { "date": "2010-02-28", "category_return_equal_weighted": 0.01, "...": "..." }
  ],
  "active_only": { "cagr_10y": 0.1894, "eligible_scheme_count": 3, "...": "..." },
  "all_schemes": { "cagr_10y": 0.1571, "eligible_scheme_count": 4, "...": "..." },
  "survivorship_gap_pp": { "cagr_1y": 0.0, "cagr_3y": 0.0, "cagr_5y": 0.0, "cagr_10y": 3.2368 }
}
```

`survivorship_gap_pp` is `active_only.cagr_*y - all_schemes.cagr_*y`, in percentage points (already `x100`, not a fraction). A positive value means the active-only average - the default shown everywhere else in the app - overstates the category by excluding schemes that closed or merged away. Either side of a pair can be requested; the response is the same either way. `active_only` or `all_schemes` is `null` when that side has no snapshot row yet (a category with fewer than two eligible members on that side never gets one - see `build_category_contexts`), and `survivorship_gap_pp` is then `{}`.

## `POST /basket`

```json
{ "scheme_codes": ["119551", "120503", "118533"], "weights": [0.5, 0.3, 0.2] }
```

Up to 10 scheme codes, no duplicates.
`weights` is optional and defaults to equal weight; when given it must have one entry per scheme code, all non-negative, summing to 1 (tolerance 1e-6) - the API refuses to guess a normalisation for the caller.

Every figure is computed over "matched months": the intersection of month-end returns across every member of the basket, since a basket mixes funds with different inception dates.
Below the shared 3-year floor (`MIN_OBS` in `mf_analytics.metrics.basket`, 24 matched months, the same floor every other risk metric in this app uses) the whole response is null with `reason: "insufficient_history"` and `matched_months` still reports how many months were actually shared, rather than either field going silently absent.

A successful response carries:

- `correlation_matrix`: pairwise Pearson correlation of monthly returns over the matched months.
- `blended`: the weighted monthly return series plus its own CAGR, volatility, Sharpe and maximum drawdown, computed start-to-end over the matched window (not the fixed 1/3/5/10y horizons the snapshot uses).
- `components`: each fund's own CAGR, volatility, Sharpe and maximum drawdown over that same window, plus its up/down capture of the blended series - what "blended risk against each component" means on the `/basket` page.
- `diversification_benefit`: the weighted average of each component's own annualised volatility minus the blend's annualised volatility. Zero for perfectly correlated components; positive otherwise.

Correlation of returns is not portfolio overlap - it says nothing about whether two funds hold the same stocks, only whether their NAVs moved together.

## `POST /admin/refresh`

Runs one of `data-master`, `data-nav`, `data-refresh`, `data-sample`, `metrics-build`, `benchmark-map`, `aum-history-import` as a subprocess.
The API releases its database handle first, so this is the way to refresh data without stopping the server.
DuckDB permits one writing process at a time; a CLI command run while the API holds the file fails with an explanatory message instead of a stack trace.

`jobs` sets the worker count for `metrics-build` and is ignored by every other step: `0` uses every core but one, which is the difference between a 15-minute rebuild and a 40-minute one.
Since this is the only way to rebuild without stopping the server, running it serially by default made the supported path the slow one.
