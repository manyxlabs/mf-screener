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

## `GET /score/{code}`

A weighted percentile score against the fund's own `clean_sub_category` peers - never a rating or a recommendation, a decomposition the caller can read component by component.

```json
{
  "scheme_code": "S01",
  "total": 65.0,
  "status": "partial",
  "missing_components": ["cost", "size_discipline"],
  "weights": {
    "risk_adjusted_return": 0.3,
    "consistency": 0.2,
    "drawdown_behaviour": 0.2,
    "cost": 0.15,
    "size_discipline": 0.15
  },
  "components": {
    "risk_adjusted_return": {
      "weight": 0.3,
      "percentile": 1.0,
      "contribution": 30.0,
      "reason": null,
      "reason_description": null
    },
    "cost": {
      "weight": 0.15,
      "percentile": null,
      "contribution": null,
      "reason": "insufficient_peer_universe",
      "reason_description": "Too few eligible peer schemes in the sub-category for this horizon."
    },
    "size_discipline": {
      "weight": 0.15,
      "percentile": null,
      "contribution": null,
      "reason": "aum_history_not_available",
      "reason_description": "..."
    }
  },
  "sub_category": "Mid Cap Fund",
  "peer_count": 5,
  "disclaimer": "..."
}
```

`weights` is the whole declared table (see `docs/data-model.md#composite-score`), echoed on every response - there is no hidden weighting.
A fund missing a component is scored on the components it has: `total` sums only the present contributions, `status` is `"partial"`, and `missing_components` names which ones did not count.
`size_discipline` has no metric until T2.3 lands AUM history, so it is always missing with reason `aum_history_not_available`, never imputed to the category mean.
404 when the scheme is unknown or has no metrics snapshot row, with the same reason `GET /schemes/{code}/metrics` would give.

## `GET /categories/{category_key}/metrics`

`category_key` is `PeerUniverse.category_key(value)`: `sub_category=<value>|plan=<plan_scope>|option=<option_scope>|active=<y|n>|agg=<mean|median>` (or `category=` at the category level). The `active=y`/`active=n` marker is the only difference between the two keys that name the same peer group under active-only and all-schemes universes.

T2.4: every category aggregate is computed over both universes and stored under its own key, so this endpoint always returns both sides of the pair alongside the row for the key that was asked for:

```json
{
  "category_key": "sub_category=Small Cap Fund|plan=direct|option=growth|active=y|agg=mean",
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

Runs one of `data-master`, `data-nav`, `data-refresh`, `data-sample`, `metrics-build`, `benchmark-map` as a subprocess.
The API releases its database handle first, so this is the way to refresh data without stopping the server.
DuckDB permits one writing process at a time; a CLI command run while the API holds the file fails with an explanatory message instead of a stack trace.
