# Benchmark CSV import format

Every file here is synthetic.
The numbers are generated, not observed, and exist only to exercise the importer and to give the UI something to render.
Do not use them for analysis.

## Required columns

`date`, `benchmark_id`, `benchmark_name`, `currency`, and one of `total_return_index` or `price`.
Optional: `asset_class`, `source`.

`currency` is required and has no default.
An unlabelled S&P 500 file would otherwise be stored as INR and regressed against rupee NAVs, and the resulting alpha, beta and tracking error would be measuring the exchange rate.

Prefer `total_return_index` over `price`.
A growth-option NAV reinvests dividends, so only a total-return index is a like-for-like comparison; a price index will understate the benchmark and flatter every fund measured against it.

## What the importer rejects

Nothing is written unless the whole file passes, and every problem is reported at once with its CSV line number:

- a missing required column
- a date that does not parse
- an index level that is zero, negative or non-numeric
- two rows with the same `benchmark_id` and `date`
- one `benchmark_id` carrying more than one currency
- a `currency` that is not a three-letter ISO code
- a `benchmark_id` with a single row, which cannot produce a return

Check a file without importing it:

    make benchmark-validate FILE=data/benchmarks_sample/invalid_example.csv

`invalid_example.csv` exists to show what a rejection looks like: it has no `currency` column, a duplicate date, an unparseable date and a negative level.

Import a valid one:

    make benchmark-import FILE=data/benchmarks_sample/nifty50_tri_sample.csv

## Currency and the S&P 500

`sp500_tr_usd_sample.csv` is deliberately in USD.
Import it and the S&P 500 feeder funds will map to it, but their alpha, beta, tracking error and benchmark information ratio all stay blank with the reason `benchmark_currency_mismatch`, and the fund page says so in words.
This project does no FX conversion.
To compare an INR feeder fund against the S&P 500, convert the index to INR yourself at each month end and import that series with `currency,INR`.

## Where to get real index data

NSE and the index providers publish total-return index history on their own sites, under their own terms.
Download the daily or month-end series yourself, rename the columns to the above, and import.
This project ships no index data, because none of the free feeds carry a redistribution licence.

If you have no TRI file, `make benchmark-proxy` builds a clearly-labelled proxy from an index fund's NAV instead.
A proxy is net of that fund's expense ratio and tracking error, so it is a floor for the index, not the index.
Every metric derived from a proxy is marked as such in the API and the UI.
A proxy is always in INR: it comes from an AMFI NAV, and even a fund tracking a US index files that NAV in rupees, having already absorbed the exchange rate its investors actually bore.
