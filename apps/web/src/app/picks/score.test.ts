import { describe, expect, it } from "vitest";
import type { ScoreResponse } from "@mf/shared";
import { scoreBreakdown } from "./score";

function score(overrides: Partial<ScoreResponse> = {}): ScoreResponse {
  return {
    scheme_code: "S01",
    total: 65,
    status: "partial",
    missing_components: ["index_skill", "steadiness"],
    coverage: 0.7,
    reason: null,
    reason_description: null,
    weights: { risk_adjusted_return: 0.3, index_skill: 0.15, steadiness: 0.15 },
    components: {
      risk_adjusted_return: {
        weight: 0.3,
        percentile: 1,
        contribution: 30,
        reason: null,
        reason_description: null,
        horizons: ["3y", "5y"],
      },
      index_skill: {
        weight: 0.15,
        percentile: null,
        contribution: null,
        reason: "insufficient_peer_universe",
        reason_description: null,
        horizons: [],
      },
      steadiness: {
        weight: 0.15,
        percentile: null,
        contribution: null,
        reason: "aum_history_not_available",
        reason_description: null,
        horizons: [],
      },
    },
    peer_group: "Mid Cap Fund · India Equity · Mid Cap",
    peer_count: 5,
    disclaimer: "Not investment advice.",
    ...overrides,
  };
}

describe("scoreBreakdown", () => {
  it("names every missing component by its reason rather than hiding it", () => {
    const text = scoreBreakdown(score());
    expect(text).toContain("Total 65/100 (partial)");
    expect(text).toContain("index_skill: missing (insufficient_peer_universe)");
    expect(text).toContain("steadiness: missing (aum_history_not_available)");
  });

  it("shows a present component's points and percentile", () => {
    const text = scoreBreakdown(score());
    expect(text).toContain("risk_adjusted_return: 30.0 of 30 pts (100th percentile over 3y/5y)");
  });

  // A percentile is only as meaningful as the group it is measured in, so the group
  // is named on the score itself rather than left to be looked up.
  it("names the peer group the percentiles are measured against", () => {
    expect(scoreBreakdown(score())).toContain("Ranked against 5 funds in Mid Cap Fund");
  });

  // A total built on 70% of the table is a different claim from one built on all of it.
  it("states how much of the weight table the fund could answer", () => {
    expect(scoreBreakdown(score())).toContain("Answers 70% of the weight table");
  });
});
