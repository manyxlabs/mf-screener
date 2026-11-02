# Contributing

Bug reports, data corrections and pull requests are all welcome.

## Reporting a problem

[Open an issue](https://github.com/manyxlabs/mf-screener/issues/new) with the page URL, what you expected and what you saw.
For a number you believe is wrong, include the fund's scheme code and where you got the figure you are comparing against.
Data from AMFI is reported as published, so check the source before reporting a NAV.

## Sending a change

1. Fork the repository and create a branch from `main`.
2. Set up the sample dataset as described in the [README](README.md#quick-start-with-the-sample-dataset).
3. Make the change, then run `make lint test e2e` and fix anything they report.
4. Open a pull request that says what changed and why, with a screenshot for anything visible.

Keep each pull request to one change.
A new metric needs its definition, caveat and missing-value reason in the column catalogue (`apps/api/mf_api/columns.py`), so the glossary and methodology pages explain it.

## Ground rules

Nothing here may read as advice: no ratings, rankings presented as recommendations, or "best fund" language.
A number that cannot be computed honestly stays blank with a stated reason rather than being estimated.
