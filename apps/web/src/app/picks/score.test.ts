import { describe, expect, it } from "vitest";
import type { ScoreResponse } from "@mf/shared";
import { scoreBreakdown } from "./score";

function score(overrides: Partial<ScoreResponse> = {}): ScoreResponse {
  return {
    scheme_code: "S01",
    total: 65,
    status: "partial",
    missing_components: ["cost", "size_discipline"],
    weights: { risk_adjusted_return: 0.3, cost: 0.15, size_discipline: 0.15 },
    components: {
      risk_adjusted_return: {
        weight: 0.3,
        percentile: 1,
        contribution: 30,
        reason: null,
        reason_description: null,
      },
      cost: {
        weight: 0.15,
        percentile: null,
        contribution: null,
        reason: "insufficient_peer_universe",
        reason_description: null,
      },
      size_discipline: {
        weight: 0.15,
        percentile: null,
        contribution: null,
        reason: "aum_history_not_available",
        reason_description: null,
      },
    },
    sub_category: "Mid Cap Fund",
    peer_count: 5,
    disclaimer: "Not investment advice.",
    ...overrides,
  };
}

describe("scoreBreakdown", () => {
  it("names every missing component by its reason rather than hiding it", () => {
    const text = scoreBreakdown(score());
    expect(text).toContain("Total 65/100 (partial)");
    expect(text).toContain("cost: missing (insufficient_peer_universe)");
    expect(text).toContain("size_discipline: missing (aum_history_not_available)");
  });

  it("shows a present component's points and percentile", () => {
    const text = scoreBreakdown(score());
    expect(text).toContain("risk_adjusted_return: 30.0 of 30 pts (100th percentile)");
  });
});
