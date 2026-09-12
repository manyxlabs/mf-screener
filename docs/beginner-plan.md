# Beginner layer: implementation plan

Status: proposed, 2026-09-12.
Approach: progressive disclosure in one UI.
Plain-English primary, technical term secondary, nothing hidden, nothing advisory.

This is not a Beginner/Pro fork.
There is one product; it starts simple and reveals depth on demand.

## 0. The one architectural decision this plan rests on

Plain labels live in `apps/api/mf_api/columns.py` as new `ColumnSpec` fields, not in a parallel TypeScript dictionary.

Add to `ColumnSpec.__slots__`: `plain_label`, `plain_definition`, `group`.
Roughly 160 of the 168 columns are produced by the factory functions (`_cagr(h)`, `_sip_xirr(h)`, `_rolling(h, stat, ...)`) and the `for h in HORIZONS` comprehensions, so about 35 authored strings cover the entire catalog across all horizons.
`as_dict()` already serialises `__slots__` reflectively, so `/columns` and the methodology `metric_catalog` pick the new fields up for free.

Consumers that then work with no extra plumbing: `MetricHeader`, `ColumnPicker`, `FilterDrawer` field labels, the methodology metric-catalog table, and the new glossary.
One pipeline, five surfaces.

**Load-bearing companion change.** `packages/shared/src/schemas.ts` uses plain `z.object`, which strips unknown keys.
Any new field added to `/columns` or `/presets` is silently dropped unless the schema is updated in the same commit.

**Rendering rule, applied everywhere.** Primary line is `plain_label ?? label`.
Secondary line, always present, smaller and muted, is `label` - the technical term.
This is the same two-line shape `ColumnPicker` already uses.
The technical term is never removed, only demoted.

## 1. Information architecture

### 1.1 Nav

Current: `Dashboard · Screener · Picks · Compare · Benchmarks · Methodology`.

Proposed: `Start · Screener · Compare · Shortlist · Glossary · Methodology`.

- `Dashboard` becomes **Start** (`/`), rewritten below.
- `Picks` becomes **Shortlist** - label only, route stays `/picks`.
  "Picks" reads as a recommendation; "Shortlist" reads as a workspace, which is what it is.
- `Benchmarks` leaves the nav.
  It is an operator and data-coverage page; link it from the methodology page and from `/data-status`.
- `Glossary` is new and sits before Methodology deliberately: the softer door comes first.
- The amber "Research and analytics only" strip stays exactly as is.
- `/basket` joins the nav or the Compare page - it is currently orphaned and reachable only by typing the URL.

### 1.2 What the landing page becomes

`apps/web/src/app/page.tsx` today opens on five count tiles, a `default_universe` bullet list, benchmark coverage, and an ingest log.
All four are operator concerns.

The new `/`, in order:

1. **Headline question, not a product name.**
   "Which Indian mutual funds have actually done what they claim?"
   One sub-line on what this is and what it is not.
2. **The search box, promoted.**
   Reuse `SchemeSearch` at large size: "Look up a fund you already own or have been pitched."
   This is the highest-intent first action and it currently hides in a 260px header slot.
3. **Five goal cards** - the renamed presets from section 5.
   Each is a question, one plain sentence, and a one-line "what this does not mean".
   Each links to `/screener?preset=<unchanged id>`.
4. **"Start with a category"** - the existing `QUICK_LINKS` chips, kept verbatim, moved below the goal cards.
5. **"Three things to know before you read any number"** - three short cards linking to methodology anchors.
   Past return is not future return.
   A fund is compared with its own sub-category peers, and peers who closed are not in that average.
   A dash means the number could not be computed honestly, and clicking it says why.
6. **One thin data-freshness line**, not tiles.

Moved off the landing page into a new `/data-status` route, verbatim: the five count tiles, the "Default screening universe" card, benchmark coverage, the ingest log, and the risk-free-rate footnote.
Nothing is deleted.
The leave-one-out description also stays on `/methodology`, where it is canonical.

### 1.3 First 60 seconds

- 0-5s: reads one question, sees it is a research tool and not a tipsheet.
- 5-15s: either types a fund they own into the promoted search, or picks a goal card.
- 15-35s: the fund page or the screener starter view opens, plain-language first.
- 35-50s: hovers a header they do not recognise.
  Gets plain sentence, then technical term, then definition, then caveat, then "Full explanation" into the glossary.
- 50-60s: clicks "Show advanced columns" or "Filters", and the depth appears.

Nobody meets "leave-one-out", `rolling_5y_median:desc`, or an ingest log in the first minute.
Every one of them is reachable in two clicks, unchanged.

## 2. Vocabulary mapping

`plain_label` values.
The technical `label` stays visible as secondary text.
Horizon-parameterised rows apply to every horizon; 5Y is the exemplar.

| `name` | Current `label` | Proposed `plain_label` |
| --- | --- | --- |
| `cagr_5y` | CAGR 5Y | Past return per year (5Y) |
| `sip_xirr_5y` | SIP XIRR 5Y | Past return per year, monthly SIP (5Y) |
| `rolling_5y_median` | Rolling 5Y median | Typical 5-year outcome |
| `rolling_5y_min` | Rolling 5Y minimum | Worst 5-year stretch on record |
| `rolling_5y_max` | Rolling 5Y maximum | Best 5-year stretch on record |
| `rolling_5y_positive_pct` | Rolling 5Y positive % | How often 5 years ended in profit |
| `rolling_5y_beat_category_pct` | Rolling 5Y beat sub-category % | How often it beat similar funds |
| `rolling_5y_std` | Rolling 5Y dispersion | How much the outcome depended on start date |
| `fund_minus_category_5y` | Excess vs sub-category 5Y | Ahead of / behind similar funds (5Y) |
| `fund_div_category_5y` | Ratio vs sub-category 5Y | Times the similar-fund average (5Y) |
| `category_return_5y` | Sub-category CAGR 5Y | Similar funds' average return (5Y) |
| `fund_minus_benchmark_5y` | Excess vs benchmark 5Y | Ahead of / behind its index (5Y) |
| `information_ratio_vs_category_5y` | Information Ratio vs Sub-category 5Y | How reliably it beat similar funds (5Y) |
| `information_ratio_vs_benchmark_5y` | IR vs benchmark 5Y | How reliably it beat its index (5Y) |
| `sharpe_5y` | Sharpe 5Y | Return earned per unit of ups and downs (5Y) |
| `sortino_5y` | Sortino 5Y | Return earned per unit of downside (5Y) |
| `volatility_5y` | Volatility 5Y | How bumpy the ride was (5Y) |
| `downside_deviation_5y` | Downside deviation 5Y | How large the bad months were (5Y) |
| `max_drawdown_5y` | Max drawdown 5Y | Worst fall from a peak (5Y) |
| `max_drawdown_5y_recovery_days` | Drawdown recovery (days) 5Y | Time taken to recover that fall |
| `calmar_5y` | Calmar 5Y | Return per unit of worst fall (5Y) |
| `tracking_error_5y` | Tracking error 5Y | How closely it follows its index (5Y) |
| `alpha_5y` | Alpha 5Y | Return the index does not explain (5Y) |
| `beta_5y` | Beta 5Y | How hard it swings with the index (5Y) |
| `r_squared_5y` | R-squared 5Y | How much the index explains (5Y) |
| `alpha_pvalue_5y` | Alpha p-value 5Y | Odds this outperformance is chance (5Y) |
| `upside_capture_5y` | Upside capture 5Y | Share of peers' good months captured |
| `downside_capture_5y` | Downside capture 5Y | Share of peers' bad months taken on |
| `worst_calendar_year_return` | Worst calendar year | Worst full year it has had |
| `positive_calendar_years_pct` | Positive calendar years | Share of years that ended up |
| `quartile_now_5y` | Quartile now (5Y) | Rank group among similar funds today (1 = top quarter) |
| `quartile_persistence_3y` | Quartile persistence (3Y) | How often it stayed in the same rank group |
| `quartile_top_share_3y` | Time in top quartile (3Y) | Time spent in the top quarter of peers |
| `quartile_transitions_3y` | Quartile changes (3Y) | How often its rank group changed |
| `style_drift_3y` | Style drift (3Y) | How much its investing style has shifted |
| `expense_ratio` | Expense ratio | Annual fee, already deducted from returns |
| `exit_load_pct` | Exit Load | Charge for selling early |
| `exit_load_period_days` | Exit Load Period | How long that early-exit charge applies |
| `lock_in_days` | Lock-in | Money cannot be withdrawn for |
| `fund_age_years` | Fund age | How long this fund has existed |
| `latest_aum` | Scheme AAUM (Quarterly Average, ₹ Cr) | Money in this exact plan (quarterly average) |
| `aum_family_latest` | Fund AUM (Family Total) | Total money in the fund, all plans |
| `aum_growth_4q` | AUM Growth (4Q) | Change in fund size over a year |
| `aum_percentile_in_sub_category` | AUM Percentile (Sub-Category) | Size compared with similar funds |
| `latest_nav` | NAV | Price of one unit today |
| `min_investment` / `min_sip` | Minimum Investment / SIP | Smallest lump sum / smallest monthly amount |
| `manager_tenure_years` | Manager Tenure | Years the current manager has run it |
| `monthly_obs_count` | (count column) | Months of history behind these numbers |

Non-metric text columns in `data-table.tsx` `TEXT_LABELS`: `clean_sub_category` to "Fund type", `cap_band` to "Company size focus", `style` to "Investing style", `clean_plan` to "Plan (Direct = no distributor commission)", `data_quality_flags` to "Data warnings", `riskometer` to "SEBI risk label".

**Language guardrails**, to be written as a comment above the plain-label block so future additions obey them.
No "best", "top", "safe", "should", "recommended", "winner".
No verb that instructs the reader.
"Similar funds" replaces "peers/sub-category" in primary text, but the technical term stays on the second line.
Every plain label describes what the number is, never what to do about it.
`direction` metadata stays as "Better: higher/lower", which is a property of the metric, not advice about a fund.

## 3. Glossary

Route `/glossary`, server component, from `getColumns()` and `getMethodology()`.

Three tiers:

1. **Concepts** - about 12 hand-written entries, the only genuinely new prose.
   Return vs risk; what a peer group is; rolling vs trailing returns; drawdown; volatility; expense ratio and Direct vs Regular; index vs active; benchmark; survivorship; why a number can be blank; what a p-value is doing on a fund screener; SIP vs lump sum.
   Each at most 120 words, each ending in a link to the methodology anchor that proves it.
2. **Metrics A-Z**, generated from `columnsMeta.metrics`, anchored at `#metric-<name>`.
   Plain label as heading, technical label and `name` in mono, `plain_definition`, `definition`, direction, "Watch out: {caveat}", and a link to the formula.
3. **Filter and page vocabulary** - Direct/Regular, Growth/IDCW, "one row per fund", "active schemes only", cap band, style, AMC, scheme code vs fund.

Group the metric list by the new `group` field with a sticky in-page nav, plus a client-side filter box mirroring `ColumnPicker`'s substring search.

Reached from every metric by three entry points, all reusing existing components:

- `MetricHeader` tooltip gains a final "Full explanation" line linking to `/glossary#metric-${spec.name}`.
  `InfoTooltip` currently closes on `onMouseLeave`, so a link inside it is not clickable on hover.
  Move the enter/leave handlers to the wrapping `<span>` - about five lines in `components/tooltip.tsx`, and it fixes keyboard focus too.
- `ColumnPicker` rows gain a "?" link to the same anchor.
- `FilterDrawer` field labels gain the same link, so a beginner setting a threshold can find out what they are thresholding.

Relationship to `/methodology`: no deletion, no duplication, an explicit division of labour.
The glossary answers "what is this and how do I read it" - prose, plain first, no formulas.
Methodology answers "how exactly is it computed and what does it refuse to compute" - formulas, peer-universe rules, minimum observations, survivorship, multiple comparisons.
Links run both ways.

## 4. Default screener view

### 4.1 The starter column set

Added to `columns.py`, leaving `DEFAULT_COLUMNS` untouched because presets, `/picks` and saved screens depend on it.

```python
STARTER_COLUMNS = (
    *PINNED_COLUMNS,  # scheme_name, scheme_code
    "clean_sub_category",  # Fund type
    "fund_age_years",  # How long this fund has existed
    "cagr_5y",  # Past return per year (5Y)
    "rolling_5y_median",  # Typical 5-year outcome
    "rolling_5y_min",  # Worst 5-year stretch on record
    "max_drawdown_5y",  # Worst fall from a peak
    "fund_minus_category_5y",  # Ahead of / behind similar funds
    "expense_ratio",  # Annual fee
    "missing_reasons",  # not rendered; powers every dash tooltip
)
```

Eight visible columns.
The set teaches the thesis of the product: one headline return, one honesty check on it (typical vs worst window), one downside number, one peer-relative number, one cost number.
`missing_reasons` must stay - `DataTable.HIDDEN_COLUMNS` suppresses it from render and `MissingValue` needs it.

Serve it as a new `"starter"` key on `GET /columns`, additive, with `"default"` unchanged.

### 4.2 The Advanced reveal

Primary state shows `Columns · Starter` plus a text button "Show advanced columns".
Clicking it switches to the current 34-column `DEFAULT_COLUMNS` immediately - one click, visible payoff - and reveals the picker for the full 168.

The picker becomes three-tier: a Starter / Standard / Everything segmented control, then, in Everything, the checkbox list grouped by the new `group` field with collapsible sections instead of today's flat 168-row scroll.

The choice persists in `localStorage` under `mf-screener.column-tier.v1`, so a returning power user is not re-onboarded.

Same treatment for `FilterDrawer`: a Basics group shown by default, everything else behind "More filters".
No filter is removed.

### 4.3 Fixing "type 0.12 to mean 12%"

The API is right and does not change.
`parse_ranges` reads raw decimals and `filters.ranges` is serialised straight into the query string.
The bug is purely presentational.

Add a `PercentInput` to `components/ui.tsx`, used by `FilterDrawer` whenever `spec.unit` is `percent` or `percentage_points`.
Display `value == null ? "" : round(value * 100, 4)` - the rounding matters, because `0.07 * 100` is `7.000000000000001` in JS.
On change store `Number(raw) / 100`; on empty string delete the range key as `setRange` does now.
Suffix `%` inside the field and drop the hint text entirely.

Saved screens in `localStorage` and preset `ranges` both store decimals and are untouched; only the widget converts.
The existing `filter-drawer.test.tsx` cases that type `0.12` become the regression test, typing `12` and asserting `0.12` on the wire.

Units that are not percentages keep the plain input, with their own hints.

### 4.4 Two adjacent screener fixes in the same shipment

Human-readable sort: replace `sorted by rolling_5y_median:desc` with a `describeSort(sort, metrics)` helper in `lib/screen-query.ts` producing "Sorted by: typical 5-year outcome, highest first", raw token on hover, unit-testable without rendering.

Result-line plain English: "342 funds match" gains, on preset load, one sentence describing the filters actually applied.

## 5. Goal-shaped presets

`id` values are unchanged, so `/screener?preset=`, `PRESETS_BY_ID`, `GET /presets/{id}` and `/picks` slot filtering all keep working.

| `id` (unchanged) | New `name` | New `subtitle` |
| --- | --- | --- |
| `long-term-consistency` | Funds that have delivered steadily for a decade | Long-term Indian equity consistency |
| `mid-multi-momentum` | Newer momentum funds in mid and multi-cap | Mid / multi-cap momentum, short track records |
| `small-cap-quality` | Small-cap funds judged on how they fell, not just how they rose | Small-cap quality, 5Y+ |
| `value-mandates` | Value and contra funds with a long record | Value and contra mandates, 7Y+ |
| `sp500-comparison` | US S&P 500 funds, ranked on how closely they track | S&P 500 comparison, tracking-quality ranked |

New fields per preset:

- `question` - the goal card heading, e.g. "Which equity funds have been consistent over 10 years?"
- `plain_description` - two sentences replacing the dense `description` on beginner surfaces.
  The existing `description` stays on the object verbatim and renders as "The exact rules" in an expandable line.
- `caution` - one line making the non-advice invariant concrete at the point of temptation.
- `order` - an explicit integer.
  The presets were alphabetically self-ordering via the "A.-E." prefixes; removing the letters removes that, so `/presets` must sort by `order` or the landing page and dropdown quietly reorder.

## 6. File-by-file change list, in shipping order

Each step is independently shippable and testable, and leaves the app working if the next never lands.

**Step 1 - Plain-label metadata in the API (half to one day).**
`columns.py`: new `ColumnSpec` fields, about 35 authored strings, `STARTER_COLUMNS`, the guardrail comment.
`main.py`: `/columns` returns `"starter"`.
`tests/test_integration_api.py`: assert every entry in `NUMERIC_BY_NAME` has a non-empty `plain_label` and a `group` - this is the guard that stops the next 20 metrics shipping jargon-only - and assert `STARTER_COLUMNS` is a subset of `SELECTABLE`.
Ships alone; the web app ignores the extra keys.

**Step 2 - Contract and rendering the plain label (half a day).**
`packages/shared/src/schemas.ts`: extend `metricSpecSchema` and `columnsResponseSchema`.
Without this the fields never reach the UI.
`metric-cell.tsx`, `data-table.tsx`, `column-picker.tsx`, `metric-cell.test.tsx`.
Visible win on its own: the whole table speaks English.

**Step 3 - Percent inputs and readable sort (half a day).**
`ui.tsx`, `filter-drawer.tsx`, `lib/screen-query.ts`, `screener-client.tsx`, plus both test files.
Highest ratio of user pain removed to lines changed.
Ship early.

**Step 4 - Glossary (one to one and a half days).**
New `app/glossary/page.tsx`, `glossary-client.tsx`, `concepts.ts`.
`tooltip.tsx` hover fix.
Links from `metric-cell.tsx`, `column-picker.tsx`, `filter-drawer.tsx`.
`methodology/page.tsx` gains plain labels and glossary links; no content removed.
`layout.tsx` nav.

**Step 5 - Starter view and the Advanced reveal (one day).**
`screener-client.tsx`, `column-picker.tsx`, `filter-drawer.tsx`, new `lib/column-tiers.ts` plus test.

**Step 6 - Goal-shaped presets (half a day).**
`presets.py`, `main.py`, `schemas.ts`, `screener-client.tsx`.
Verify `picks-client.tsx` still reads `preset.slot`.

**Step 7 - Landing page and `/data-status` (one day).**
New `app/data-status/page.tsx` receiving the moved cards verbatim.
`app/page.tsx` rewritten.
`scheme-search.tsx` gains a size prop.
`layout.tsx` nav.

**Step 8 - Docs and copy sweep (half a day).**
`README.md`, `docs/api.md`, and a grep sweep over `app/fund/[scheme_code]/*` and `compare-client.tsx`.

Total: roughly six to seven working days.
No design-system change, no new dependency, no parallel metadata source, no route deleted.

## Where this could go wrong

- **The zod strip.**
  Steps 1 and 6 look complete on the API and appear to do nothing in the browser until the schema is extended.
  Pair the commits.
- **Tooltip hover-out.**
  Adding a link inside `InfoTooltip` without fixing the mouse-leave handler produces an unclickable link.
- **Float display in `PercentInput`.**
  Round the multiplication, or users see `7.000000000000001`.
- **Preset ordering.**
  Dropping the "A.-E." prefixes silently reorders the dropdown and the landing cards unless `order` lands in the same commit.
- **`missing_reasons` in the starter set.**
  Omit it and every dash loses its explanation, breaking exactly the honesty property this plan exists to make more accessible.
