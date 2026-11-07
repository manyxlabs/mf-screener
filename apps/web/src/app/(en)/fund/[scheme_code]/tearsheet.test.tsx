import type {
  Behaviour,
  Benchmark,
  Exposure,
  MetricSpec,
  MetricsSnapshot,
  Scheme,
} from "@mf/shared";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { RollingExposure } from "@/lib/api";
import { Tearsheet } from "./tearsheet";

const scheme: Scheme = {
  scheme_code: "S1",
  scheme_name: "Alpha Bluechip Fund",
  amc: "Alpha AMC",
  clean_category: "Equity",
  clean_sub_category: "Large Cap Fund",
  clean_plan: "Direct",
  clean_option: "Growth",
  isin_growth: "INF000A0X000",
  isin_dividend: null,
  is_active: true,
  first_nav_date: "2010-01-01",
  last_nav_date: "2026-08-31",
  latest_nav: 123.4567,
  latest_nav_date: "2026-08-31",
  latest_aum: 5000,
  aum_quarter: "2026-Q2",
  fund_age_years: 16.6,
  expense_ratio: 0.011,
  fund_family_id: "alpha-amc:alpha-bluechip-fund",
};

const spec = (name: string, unit: string): MetricSpec => ({
  name,
  label: name,
  unit,
  definition: "d",
  period: "p",
  frequency: "monthly",
  direction: "higher_is_better",
  caveat: "",
  plain_label: name,
  plain_definition: "d",
  group: "Returns",
});

const specs: Record<string, MetricSpec> = {
  cagr_1y: spec("cagr_1y", "percent"),
  cagr_3y: spec("cagr_3y", "percent"),
  sharpe_3y: spec("sharpe_3y", "ratio"),
};

const record: Record<string, unknown> = {
  cagr_1y: 0.12,
  cagr_3y: 0.15,
  category_return_3y: 0.11,
  benchmark_return_3y: 0.1,
  rolling_3y_mean: 0.13,
  rolling_3y_positive_pct: 0.9,
  rolling_3y_beat_category_pct: 0.6,
  rolling_3y_beat_benchmark_pct: 0.55,
  rolling_3y_window_count: 84,
  sharpe_3y: 1.2,
};

const metrics: MetricsSnapshot = {
  scheme_code: "S1",
  as_of_date: "2026-08-31",
  benchmark_id: "NIFTY100",
  category_key: "large_cap",
  monthly_obs_count: 190,
  nav_gap_months: 0,
  data_quality_flags: [],
  missing_reasons: { volatility_10y: "insufficient_observation_count" },
  missing_reason_descriptions: {
    insufficient_observation_count: "Fewer months of NAV than the minimum this metric needs.",
  },
  methodology_version: "1.4.0",
};

const behaviour: Behaviour = {
  scheme_code: "S1",
  category_key: "large_cap",
  min_drawdown_depth: 0.1,
  drawdowns: [
    {
      peak_date: "2020-01-14",
      trough_date: "2020-03-23",
      depth: -0.38,
      recovered_date: "2020-11-04",
      days_to_trough: 69,
      days_to_recover: 295,
    },
  ],
  calendar_years: [],
  capture_peer_basis: "leave_one_out_category_average" as const,
  capture_by_horizon: {
    "3y": { up: 1.05, down: 0.9, reason: null },
    "5y": { up: 1.02, down: 0.95, reason: null },
  },
  capture: { up: 1.05, down: 0.9, reason: null, horizon_years: 3 },
  cost: {
    expense_ratio: 0.011,
    category_median: 0.014,
    category_count: 22,
    reason: null,
    horizon_years: 10,
    difference: -0.003,
    shortfall_vs_median: 0.031,
  },
  disclaimer: "Not investment advice.",
};

const exposure: Exposure = {
  scheme_code: "S1",
  method: "constrained_ols",
  weights: [{ benchmark_id: "NIFTY100", benchmark_name: "Nifty 100 TRI", weight: 0.92 }],
  r_squared: 0.94,
  months: 96,
  first_date: "2018-01-31",
  last_date: "2026-08-31",
  reason: null,
  basis: [],
  caveat: "Inferred from NAV, not holdings.",
  disclaimer: "Not investment advice.",
};

const rollingExposure: RollingExposure = {
  scheme_code: "S1",
  method: "constrained_ols",
  window_months: 36,
  points: [],
  style_drift_3y: { value: 0.04, n_obs: 60, reason: null },
  basis: [],
  caveat: "Inferred from NAV, not holdings.",
  disclaimer: "Not investment advice.",
};

const benchmark: Benchmark = {
  benchmark_id: "NIFTY100",
  benchmark_name: "Nifty 100 TRI",
  currency: "INR",
  source: "NSE",
  confidence: "high",
  notes: null,
  comparable_with_inr_funds: true,
  fund_currency: "INR",
};

function baseProps() {
  return {
    scheme,
    metrics,
    record,
    specs,
    behaviour,
    exposure,
    rollingExposure,
    benchmark,
    disclaimer: "Research and analytics only. Not investment advice.",
    missingByReason: [["insufficient_observation_count", ["volatility_10y"]]] as [
      string,
      string[],
    ][],
  };
}

describe("Tearsheet", () => {
  it("renders identity, returns, rolling, risk, drawdowns, cost, exposure and the footer", () => {
    render(<Tearsheet {...baseProps()} />);
    expect(screen.getByText("Alpha Bluechip Fund")).toBeDefined();
    expect(screen.getByText("12.00%")).toBeDefined(); // cagr_1y
    expect(screen.getByText("15.00%")).toBeDefined(); // cagr_3y
    expect(screen.getByText("1.20")).toBeDefined(); // sharpe_3y
    expect(screen.getByText(/-38\.00%/)).toBeDefined(); // drawdown depth
    expect(screen.getByText(/Nifty 100 TRI 92%/)).toBeDefined();
    expect(screen.getByText(/Methodology v1\.4\.0, as of 2026-08-31/)).toBeDefined();
    expect(screen.getByText("Research and analytics only. Not investment advice.")).toBeDefined();
  });

  it("states every missing-data reason", () => {
    render(<Tearsheet {...baseProps()} />);
    expect(
      screen.getByText(/Fewer months of NAV than the minimum this metric needs\.: volatility_10y/),
    ).toBeDefined();
  });

  it("explains the reason in words rather than printing its code", () => {
    const props = baseProps();
    props.exposure = { ...exposure, weights: [], reason: "insufficient_shared_history" };
    props.metrics = {
      ...props.metrics,
      missing_reason_descriptions: {
        ...props.metrics.missing_reason_descriptions,
        insufficient_shared_history:
          "The fund and the style basis do not share enough months to fit an exposure.",
      },
    };
    render(<Tearsheet {...props} />);
    expect(screen.getByText(/do not share enough months to fit an exposure/)).toBeDefined();
    // The whole point: the reader is never handed the raw snake_case name.
    expect(screen.queryByText(/insufficient_shared_history/)).toBeNull();
  });

  it("falls back to the reason code only when no description carries it", () => {
    const props = baseProps();
    props.exposure = { ...exposure, weights: [], reason: "some_unmapped_reason" };
    render(<Tearsheet {...props} />);
    expect(screen.getByText(/some_unmapped_reason/)).toBeDefined();
  });

  it("stays hidden on screen and print-only via the className the page passes in", () => {
    const { container } = render(<Tearsheet {...baseProps()} className="hidden print:block" />);
    expect(container.firstElementChild?.className).toContain("hidden");
    expect(container.firstElementChild?.className).toContain("print:block");
  });
});
