import { describe, expect, it } from "vitest";
import { benchmarkSchema, metricsSnapshotSchema, screenResponseSchema } from "./schemas";

const methodology = {
  as_of: "2026-08-31",
  version: "1.0.0",
  peer_universe: {
    level: "sub_category",
    plan_scope: "direct",
    option_scope: "growth",
    active_only: true,
    aggregation: "mean",
    exclude_self: true,
    min_peers: 5,
  },
  risk_free_annual: 0.065,
  applied_filters: {},
  sort: ["cagr_5y:desc"],
  note: "n",
  disclaimer: "Not advice.",
};

describe("screenResponseSchema", () => {
  it("accepts null metrics without coercing them to zero", () => {
    const parsed = screenResponseSchema.parse({
      total: 1,
      page: 1,
      page_size: 50,
      pages: 1,
      columns: ["scheme_code", "cagr_5y"],
      rows: [{ scheme_code: "S01", cagr_5y: null }],
      methodology,
    });
    expect(parsed.rows[0]!.cagr_5y).toBeNull();
  });

  it("rejects a response missing its methodology block", () => {
    expect(() =>
      screenResponseSchema.parse({
        total: 0,
        page: 1,
        page_size: 50,
        pages: 0,
        columns: [],
        rows: [],
      }),
    ).toThrow();
  });
});

describe("metricsSnapshotSchema", () => {
  it("keeps unknown metric columns and defaults the quality fields", () => {
    const parsed = metricsSnapshotSchema.parse({
      scheme_code: "S01",
      as_of_date: "2026-08-31",
      benchmark_id: null,
      category_key: null,
      monthly_obs_count: 120,
      nav_gap_months: 0,
      data_quality_flags: ["nav_gaps"],
      missing_reasons: { cagr_10y: "insufficient_history" },
      missing_reason_descriptions: {},
      methodology_version: "1.0.0",
      some_future_metric: 1.23,
    });
    expect(parsed.data_quality_flags).toEqual(["nav_gaps"]);
    expect(parsed["some_future_metric"]).toBe(1.23);
  });
});

describe("benchmarkSchema", () => {
  const base = {
    benchmark_id: "SP500_TR_USD",
    benchmark_name: "S&P 500 Total Return",
    currency: "USD",
    source: "csv:sp500.csv",
    confidence: "currency_mismatch",
    notes: null,
  };

  it("carries the comparability verdict rather than leaving it to be inferred", () => {
    const parsed = benchmarkSchema.parse({
      ...base,
      comparable_with_inr_funds: false,
      fund_currency: "INR",
    });
    expect(parsed.comparable_with_inr_funds).toBe(false);
  });

  it("rejects a benchmark that omits it, so the guard cannot silently disappear", () => {
    // Were this optional, an API change would make every foreign benchmark render as a
    // normal one: a falsy default is indistinguishable from "comparable" at a glance.
    expect(() => benchmarkSchema.parse(base)).toThrow();
  });
});
