# Indian mutual fund screener. Every target is safe to re-run.
SHELL := /bin/bash
UV ?= uv
PNPM ?= pnpm
PY := $(UV) run python -m mf_analytics.cli

.DEFAULT_GOAL := help
.PHONY: help bootstrap data-master data-nav data-sample data-refresh data-build provenance \
        benchmark-import benchmark-validate benchmark-coverage benchmark-proxy style-basis \
        benchmark-map benchmark-sample ter-import holdings-validate holdings-import \
        metrics inspect validate api web dev test test-py test-js lint lint-py lint-js \
        typecheck format build clean-data

help: ## List targets
	@grep -hE '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-18s\033[0m %s\n", $$1, $$2}'

bootstrap: ## Install Python and Node dependencies, create data dirs and .env
	@command -v $(UV) >/dev/null || { echo "uv is required: https://docs.astral.sh/uv/"; exit 1; }
	@command -v $(PNPM) >/dev/null || { echo "pnpm is required: npm i -g pnpm"; exit 1; }
	@test -f .env || { cp .env.example .env; echo "created .env from .env.example"; }
	$(UV) sync
	$(PNPM) install
	$(PNPM) --filter @mf/shared build
	$(PY) init
	@echo "Bootstrap complete. Next: make data-sample (small) or make data-build (full)."

inspect: ## Print the provider's live schema and how it maps to the canonical model
	$(PY) inspect-schema

provenance: ## Show the raw artefacts the local store was built from, with checksums
	$(PY) provenance

data-master: ## Download and normalise the scheme master (~1.5 MB)
	$(PY) data-master $(if $(FORCE),--force,)

data-nav: ## Download and normalise the full NAV history (~170 MB, resumable)
	$(PY) data-nav $(if $(FORCE),--force,)

data-sample: ## Build a small development dataset (a few dozen schemes)
	$(PY) data-sample
	$(MAKE) benchmark-sample
	$(MAKE) metrics
	$(PY) validate

ter-import: ## Refresh expense ratios from the configured TER source
	$(PY) ter-import

data-refresh: ## Incrementally top up recent NAVs, then rebuild metrics
	$(PY) data-refresh
	$(MAKE) benchmark-map
	$(MAKE) ter-import
	$(MAKE) metrics

data-build: ## Full pipeline: master + NAV + benchmarks + metrics + validation
	$(MAKE) data-master
	$(MAKE) data-nav
	$(MAKE) benchmark-map
	$(MAKE) benchmark-coverage
	$(MAKE) ter-import
	$(MAKE) metrics
	$(PY) validate

metrics: ## Recompute category series and the per-scheme metrics snapshot
	$(PY) metrics-build

benchmark-validate: ## Check a benchmark CSV without importing: make benchmark-validate FILE=path/to.csv
	@test -n "$(FILE)" || { echo "usage: make benchmark-validate FILE=data/benchmarks_sample/nifty50_tri_sample.csv"; exit 1; }
	$(PY) benchmark-validate --file $(FILE)

benchmark-import: ## Import a benchmark CSV: make benchmark-import FILE=path/to.csv
	@test -n "$(FILE)" || { echo "usage: make benchmark-import FILE=data/benchmarks_sample/nifty50_tri_sample.csv"; exit 1; }
	$(PY) benchmark-import --file $(FILE)
	$(MAKE) benchmark-map

holdings-validate: ## Check a holdings CSV without importing: make holdings-validate FILE=path/to.csv
	@test -n "$(FILE)" || { echo "usage: make holdings-validate FILE=path/to/holdings.csv"; exit 1; }
	$(PY) holdings-validate --file $(FILE)

holdings-import: ## Import a holdings CSV: make holdings-import FILE=path/to.csv
	@test -n "$(FILE)" || { echo "usage: make holdings-import FILE=path/to/holdings.csv"; exit 1; }
	$(PY) holdings-import --file $(FILE)

benchmark-coverage: ## Show what the loaded benchmarks cover and where they fall short
	$(PY) benchmark-coverage

style-basis: ## Build the style-factor proxies that returns-based exposure is fitted against
	$(PY) style-basis

benchmark-proxy: ## Build a labelled benchmark proxy: make benchmark-proxy CODE=100484 ID=NIFTY50_TRI NAME="Nifty 50"
	@test -n "$(CODE)" -a -n "$(ID)" -a -n "$(NAME)" || { echo 'usage: make benchmark-proxy CODE=... ID=... NAME="..."'; exit 1; }
	$(PY) benchmark-proxy $(CODE) $(ID) "$(NAME)"
	$(MAKE) benchmark-map

benchmark-sample: ## Proxy benchmarks from index funds in the sample dataset
	-$(PY) benchmark-proxy 100484 NIFTY50_TRI "Nifty 50 (index-fund proxy)"
	-$(PY) benchmark-proxy 148381 SP500_TR_INR "S&P 500 INR (index-fund proxy)"
	$(MAKE) benchmark-map

benchmark-map: ## Apply the sub-category to benchmark mapping config
	$(PY) benchmark-map

validate: ## Report row counts, coverage and data-quality warnings
	$(PY) validate

api: ## Start the FastAPI backend on :8000
	$(UV) run uvicorn mf_api.main:app --host $${MF_API_HOST:-127.0.0.1} --port $${MF_API_PORT:-8000} --reload

web: ## Start the Next.js frontend on :3000
	$(PNPM) --filter @mf/web dev

dev: ## Start backend and frontend together
	@trap 'kill 0' EXIT INT TERM; $(MAKE) api & $(MAKE) web & wait

test: test-py test-js ## Run every test suite

test-py: ## Run the Python tests
	$(UV) run pytest -q

test-js: ## Run the TypeScript tests
	$(PNPM) -r test

lint: lint-py lint-js ## Lint everything

lint-py: ## ruff check + format check + mypy
	$(UV) run ruff check .
	$(UV) run ruff format --check .
	$(UV) run mypy

lint-js: ## eslint + prettier check
	$(PNPM) --filter @mf/web lint
	$(PNPM) format:check

typecheck: ## TypeScript type check across the workspace
	$(PNPM) -r typecheck

format: ## Apply formatters
	$(UV) run ruff format .
	$(PNPM) format

build: ## Production build of the frontend, into .next-build so `make web` keeps serving
	$(PNPM) --filter @mf/shared build
	NEXT_DIST_DIR=.next-build $(PNPM) --filter @mf/web build

clean-data: ## Delete every downloaded and derived artefact (keeps .env)
	rm -rf data/raw/* data/processed/* data/cache/* data/exports/*
	@for d in raw processed cache exports; do touch data/$$d/.gitkeep; done
