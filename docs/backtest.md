# Backtest: does the composite score precede better returns?

`scripts/backtest_score.py` re-forms the ranking at past dates and measures what happened next.
It reads nothing from the stored metrics snapshot.
Every input is recomputed from the monthly NAV series as of the formation date, through the same metric functions the live pipeline uses, so the ranking cannot see its own future.

```
uv run python scripts/backtest_score.py                       # four dates, forward 3y, both modes
uv run python scripts/backtest_score.py --mode ic --horizon 5 # per-signal, forward 5y
```

Formation dates: 2019-08-31, 2020-08-31, 2021-08-31, 2022-08-31.
Universe: Direct-Growth schemes with at least 36 months of NAV by the formation date and a NAV row three years later - roughly 600-700 funds per date, across 30-33 sub-categories.
Forward return: annualised, month-end to month-end, from the formation date.

## What predicted, and what did not

Information coefficient is the Spearman correlation between the signal and the next three years' return, computed **within each sub-category** and pooled across categories weighted by fund count.
Within-category is the only comparison that matters here: a signal that merely picks the right category would look strong across the whole universe and be useless for choosing between two small-cap funds.

| Signal                                              |  pooled IC | right sign at |
| --------------------------------------------------- | ---------: | ------------: |
| `momentum_12_1` (11 months ending one month back)   | **+0.172** |  3 of 4 dates |
| `cagr_1y` (the same idea without the skipped month) |     +0.180 |        2 of 4 |
| `expense_ratio` (lower better), as charged then     |     -0.024 |        2 of 4 |
| `expense_ratio` (lower better), today's fee         |    +0.135* |       4 of 4* |
| `rolling_3y_median`                                 |     +0.127 |        4 of 4 |
| `rolling_5y_median`                                 |     +0.118 |        4 of 4 |
| `cagr_3y` (= peer excess)                           |     +0.088 |        3 of 4 |
| `cagr_5y` (= peer excess)                           |     +0.083 |        3 of 4 |
| `sortino_3y`                                        |     +0.058 |        2 of 4 |
| `sharpe_3y`                                         |     +0.057 |        2 of 4 |
| `sortino_5y`                                        |     +0.056 |        3 of 4 |
| `sharpe_5y`                                         |     +0.044 |        3 of 4 |
| `volatility_5y` (lower better)                      | **-0.202** |        0 of 4 |
| `volatility_3y` (lower better)                      | **-0.229** |        0 of 4 |

\* The starred row read today's fee against every past formation date, before `scheme_ter_history` existed, and the cost signal did not survive being measured properly.
Read from the fee disclosed in the formation month (`make data-ter-history`), it predicts nothing within a peer group, on 619 fund-observations rather than 1,055 - historical names match today's master less often.
The +0.135 was look-ahead: a fund that did well grew, and SEBI's TER slabs charge a bigger fund less, so today's low fee was partly a record of past success.
The other rows here were taken with the fee read the old way but do not use it; the 2026 re-run moved none of them by more than 0.03.
It also covers fewer funds (1,055 fund-observations against ~2,200), since the TER source covers only part of the industry.

`cagr_1y` scores a higher IC than the 12-1 version but with the right sign at only two of four dates: the unskipped month adds return and noise together.
That is why the pipeline computes `momentum_12_1` rather than reusing the stored one-year return.

Four things follow, and the weight table in `scoring.py` follows them:

1. **Momentum was the strongest signal measured**, which is also what the machine-learning literature finds survives out of sample (Kaniel et al., NBER 2022, reduce their model to investor sentiment, fund flow and 12-1 momentum with almost no loss). It is weighted at only 0.10 all the same: it was right at three dates of four, it turns over fast, and chasing it has a trading cost this tool cannot see. (It began at 0.05; the walk-forward search below doubled it.)
2. **Cost looked like the most stable signal, and measured point-in-time it is not one** (see the starred row). It keeps 0.20 for reasons that do not depend on that measurement: it is the only mechanical input - a fee is deducted whatever the market does - Morningstar's repeated study finds the cheapest quintile beats the priciest in every period tested, and removing it measured worse on held-out dates (below).
3. **The typical rolling window beat the point-to-point return at every date.** `rolling_*_median` was right at all four formations, which is why `consistency` carries the largest weight (0.30) rather than raw or peer-relative return.
4. **Ranking the calmer fund higher was wrong at every single formation date.** Low volatility had an IC of about -0.2 in all four windows: within a sub-category, the more volatile fund reliably went on to return more. Over 2019-2025 Indian equity rose almost throughout, and in a rising market that is what beta does. `steadiness` therefore keeps only 0.02, and it is there as a stated preference for a smoother ride, not as a claim about return.
   It is the one component whose measured sign is wrong, so it carries the smallest weight in the table; it is not zero because a score with no risk term at all would rank a fund that fell 60% and recovered above one that never fell, and say nothing about the difference.
   The 0.03 it gave up went to `consistency` rather than to `cost`: both were right at all four dates, but the rolling median is measured point-in-time while the expense ratio is read from today's snapshot against a past formation date, so only one of the two is uncontaminated evidence.

### Three years against five

The table above measures each idea at both horizons, so the blend inside every component is set by it rather than by taste.

| Idea               |      3-year reading |      5-year reading |
| ------------------ | ------------------: | ------------------: |
| rolling median     | **+0.127** (4 of 4) |     +0.118 (4 of 4) |
| CAGR / peer excess | **+0.088** (3 of 4) |     +0.083 (3 of 4) |
| Sharpe             |     +0.057 (2 of 4) | +0.044 (**3 of 4**) |
| Sortino            |     +0.058 (2 of 4) | +0.056 (**3 of 4**) |
| volatility         |     -0.229 (0 of 4) |     -0.202 (0 of 4) |

This is a dead heat.
Three years wins every mean-IC comparison and loses both sign-consistency comparisons, and the gaps are a hundredth of an IC point across four overlapping windows - which is noise, not a finding.
Where three years does win clearly is coverage: it exists for 2,234 fund-observations across 30 sub-categories against 1,841 across 25, so a 3-year-heavy blend simply scores more funds.

`HORIZON_WEIGHTS` therefore moved from `{3y: 0.25, 5y: 0.45, 10y: 0.30}` to `{3y: 0.35, 5y: 0.40, 10y: 0.25}` - three years raised toward five, not past it.

The reason it does not lead outright is visible in the per-date detail.
At the 2022 formation date `cagr_3y` scored +0.340, beside `cagr_1y` +0.339 and `momentum_12_1` +0.291.
At short horizons the return column _is_ the momentum signal, and this table prices momentum at 0.10 on purpose because it is unstable and expensive to chase.
A 3-year-led score would buy that same bet back at several times the weight, without saying so.

Ten years is unmeasured here: too few funds owned a decade of history at a past formation date to correlate against, so its weight rests on the same reasoning it always did rather than on evidence.

### Fund flow: acquired, tested, and not used

Fund flow is the characteristic the machine-learning literature rates highest, and getting it was the reason AMFI's AAUM history was imported at all (65 quarters, June 2010 to June 2026).
It is the one signal here that is fully point-in-time: the backtest reads only quarters AMFI had published as of each formation date.

It does not work on this universe.

| Construction                                                      | pooled IC | right sign at | per date                       |
| ----------------------------------------------------------------- | --------: | ------------: | ------------------------------ |
| `flow_4q` - four-quarter growth in AAUM                           |    -0.050 |        2 of 4 | +0.002, -0.228, -0.019, +0.023 |
| `flow_implied_4q` - the same, divided by the fund's own NAV ratio |    -0.056 |        2 of 4 | +0.018, -0.187, -0.068, +0.000 |

The second row matters. Raw asset growth is largely last year's return wearing a hat, and last year's return is already a signal in its own right, so the first measurement could have been dismissed as contaminated.
Dividing the asset ratio by the fund's NAV ratio over the same span strips the market movement out and leaves what units were actually bought or sold - and the result is the same, slightly negative and unstable.
Money arriving after a good run, before a worse one, is the familiar "dumb money" pattern; on this sample it is noise around zero rather than a signal to trade on.

Flow therefore carries **no weight**, and this is why - not because it was never tried.
Three caveats on the negative result: AAUM is a quarterly _average_ rather than a point, so a quarter's flow is smeared; implied flow still cannot separate a subscription from a distribution reinvested; and four overlapping windows in one bull market is a thin test to reject a well-documented effect on.
Re-run `scripts/backtest_score.py --mode ic` when a different regime is in the data.

`index_skill` (information ratio vs benchmark, falling back to alpha) is **not** in the table above: reconstructing it at a past date needs the benchmark series mapped as of that date, which the stored map does not carry. It is priced at 0.05 until it can be measured the same way.

## The composite

Universe-wide quintiles of the score are not a meaningful test and are printed only for completeness - a score of 80 in Liquid Fund and 80 in Small Cap are percentiles in different populations, so a universe-wide ladder mostly reports which categories did well.
The line to read is the within-peer-group one: how often the top quintile of a group beat that group's median.

The table has been re-weighted four times on these measurements. Where the composite stood at each step:

| Weight table                                                                                                                                 |    2019 |    2020 |    2021 |    2022 |
| -------------------------------------------------------------------------------------------------------------------------------------------- | ------: | ------: | ------: | ------: |
| First try (peer excess .30 / consistency .20 / risk-adj .20 / steadiness .15 / index skill .15)                                              |       - |       - |     53% |     67% |
| Second (consistency .35 / peer excess .25 / risk-adj .20 / steadiness .10 / index skill .10)                                                 |     57% |     63% |     59% |     67% |
| Third (consistency .33 / cost .20 / peer excess .20 / risk-adj .15 / momentum .05 / steadiness .02 / index skill .05), within `peer_group`   |     67% | **66%** |     63% |     69% |
| Current, fee read from today (look-ahead)                                                                                                    | **70%** |     62% | **71%** | **75%** |
| Current (consistency .33 / cost .20 / peer excess .20 / risk-adj .10 / momentum .10 / steadiness .02 / index skill .05), fee as charged then |     60% |     59% |     65% |     62% |

The percentage is how often the top quintile of a peer group beat that group's median over the next three years, against 50% for a coin.
The third row is measured within the refined peer groups, so it is not strictly comparable with the two above it - part of the improvement is that the groups now hold funds that were actually alternatives to each other.
The last row is the honest one: the same table, with each fund priced at the fee it charged at the formation date.
The points it gives up against the row above it are what reading today's fee had been worth. The third row read today's fee as well, so it is flattered the same way; the first two carried no cost component.
Median edge on the last row ran +0.14, +0.12, +0.15 and +0.03 percentage points a year.
Median edge ran +0.18, +0.16, +0.12 and +0.04 percentage points a year: consistently positive, consistently small.

### Where the score is and is not informative

The quintile ladders are the part worth reading carefully, because they are not monotone.

| Formation | Q1 (lowest score) |         Q2 |     Q3 |     Q4 | Q5 (highest) |
| --------- | ----------------: | ---------: | -----: | -----: | -----------: |
| 2019      |             9.99% |     10.67% | 10.10% | 12.37% |   **13.68%** |
| 2020      |            11.89% | **15.54%** | 14.86% | 13.65% |       13.26% |
| 2021      |            10.59% | **14.57%** | 14.21% | 13.46% |       11.16% |
| 2022      |            11.21% |     11.82% | 11.25% | 11.05% |   **14.93%** |

(Median forward 3-year CAGR. Universe-wide, so across peer groups - which is why the levels move with the market rather than with the score.)

The top quintile led at two of four dates, sat fourth of five at one, and was second worst at another.
The rank correlation between score and forward return was +0.048, +0.018, +0.025 and +0.142: positive every time, and tiny every time.

The one stable pattern is at the other end. **The lowest quintile was the worst or near-worst bucket at three of the four dates**, and it never led.
That asymmetry is the honest summary of what this score does: it is better at identifying the part of a peer group that has been lagging than at identifying which fund will lead it.

Read the numbers honestly.
The direction is right at every date and at no date is it dramatic: a tilt, not a winner-picker.
Anyone reading a single fund's score should take it as "this fund has been in the better part of its peer group on the things that have been worth something", not as a forecast.
There is deliberately no threshold anywhere in this project at which a score becomes a recommendation - the score is a percentile, so it is relative by construction, and the top of a peer group that lost money is still a fund that lost money.

## Walk-forward weight search

`scripts/optimize_weights.py` asks whether a different weight table would have ranked better, without letting the answer see its own test.

```
uv run python scripts/optimize_weights.py --build       # point-in-time percentiles, 28 quarterly dates
uv run python scripts/optimize_weights.py               # grid search on train dates, judged on test dates
uv run python scripts/optimize_weights.py --neighbours  # small moves around the live table
```

The build forms the ranking at every quarter-end from December 2018 to September 2025, the same way the backtest above does, and stores each fund's percentile on each component.
Weights only enter at the final blend, so all 3,003 tables on a 0.1 grid can be scored from that one cache.
Tables are chosen on early formation dates and then read on later ones they never saw:

| Forward return | Train formations  | Held-out formations |
| -------------- | ----------------- | ------------------- |
| 3 years        | Dec 2018-Dec 2020 | Dec 2021-Sep 2023   |
| 1 year         | Dec 2018-Dec 2022 | Dec 2023-Sep 2025   |

The 1-year split's held-out dates cover the 2024-25 correction, which no window in the four-date backtest reached.

**The grid search's winners lost.**
At 3 years the best training tables put 60-80% on consistency, and on the held-out dates they scored an IC of +0.11 to +0.18 against the live table's +0.214.
At 1 year they put 70-90% on momentum, and scored +0.145 to +0.167 against +0.186.
Which single signal leads changes with the market phase, and a table built around one of them is fitting that phase.
The diversified table was the robust one.

**One small move helped everywhere.**
Moving 0.05 from risk-adjusted return to momentum raised IC on all four reads - train and test, both horizons - and was the largest such move:

| Table                       |   3y train |    3y test | 3y test hit | 3y worst test date |   1y train |    1y test | 1y test hit |
| --------------------------- | ---------: | ---------: | ----------: | -----------------: | ---------: | ---------: | ----------: |
| risk-adj .15 / momentum .05 |     +0.090 |     +0.214 |         66% |             +0.108 |     +0.119 |     +0.186 |         70% |
| risk-adj .10 / momentum .10 | **+0.096** | **+0.227** |     **69%** |         **+0.168** | **+0.131** | **+0.189** |         69% |
| risk-adj .05 / momentum .15 |     +0.098 |     +0.240 |         70% |             +0.152 |     +0.140 |     +0.190 |         67% |

Going further kept improving the 3-year read and started costing the 1-year one, so the table stops at .10 / .10.
The gain is small - a hundredth of an IC point at 1 year - and it is adopted because it is consistent, not because it is large.

Moving steadiness's 0.02 to any other component also helped on all four reads, which is the walk-forward test agreeing with the four-date one that the calmer fund returned less.
It stays at 0.02 for the reason given above: it is a declared preference, not a prediction.

**Re-measured with the fee charged at each formation date.**
The figures above read today's fee. With `scheme_ter_history` the live table scores 3y held-out IC +0.201 (hit 58%) and 1y +0.161 (63%).
The momentum move still holds: against risk-adj .15 / momentum .05 it raises three of the four reads and leaves the fourth flat (1y held-out +0.162 to +0.161).
Cost alone now reads -0.029 and -0.013 at 3 years, train and held-out; yet every table that cut it scored worse on the held-out dates (0.20 to 0 into consistency: +0.201 to +0.159), so no cost move passes the four-read rule and the table is unchanged.
A fee is rankable for only 12-23% of fund-dates, because a peer group needs six priced funds and historical names often fail the exact match; this is the thinnest measurement in this document.

## Biases, none of them corrected

- **Survivorship.** Only schemes in today's master are in the file, so funds wound up between the formation date and now are largely absent. This flatters every bucket, though not obviously one more than another.
- **The peer group is today's label**, not the one the fund carried at the formation date.
- **Overlapping windows.** Four formation dates one year apart, each measured over three years, are not four independent experiments.
- **One market regime.** Every window tested sits inside a long Indian bull market. The volatility finding in particular should be expected to reverse in a drawdown, which is exactly why `steadiness` was cut rather than inverted.
- **Three years is short** for a claim about fund selection. Treat everything here as a sanity check on the ranking, not as evidence that any score picks winners.
