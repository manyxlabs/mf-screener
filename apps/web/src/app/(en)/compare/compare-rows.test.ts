import { describe, expect, it } from "vitest";
import en from "@/messages/en";
import { derive, derivedSpecs, extremes, type Entry } from "./compare-rows";

describe("extremes", () => {
  it("marks the largest value best when higher is better", () => {
    expect(extremes([0.1, 0.3, 0.2], "higher_is_better")).toEqual({ best: 0.3, worst: 0.1 });
  });

  it("marks the smallest value best when lower is better", () => {
    expect(extremes([0.1, 0.3, 0.2], "lower_is_better")).toEqual({ best: 0.1, worst: 0.3 });
  });

  it("marks a shallower drawdown as the better one", () => {
    // Drawdowns are negative and higher_is_better, so -12% must beat -40%.
    expect(extremes([-0.4, -0.12], derivedSpecs(en)["worst_fall"]!.direction)).toEqual({
      best: -0.12,
      worst: -0.4,
    });
  });

  it("marks nothing on a metric with no better direction", () => {
    expect(extremes([0.8, 1.2], "context")).toEqual({ best: null, worst: null });
  });

  it("marks nothing when only one fund has the value", () => {
    expect(extremes([null, 0.3, null], "higher_is_better")).toEqual({ best: null, worst: null });
  });

  it("marks nothing when every fund ties, because that is not a ranking", () => {
    expect(extremes([0.2, 0.2], "higher_is_better")).toEqual({ best: null, worst: null });
  });

  it("ignores missing values rather than treating them as zero", () => {
    expect(extremes([null, -0.5, -0.1], "higher_is_better")).toEqual({ best: -0.1, worst: -0.5 });
  });
});

function entry(behaviour: Partial<Entry["behaviour"]>): Entry {
  return {
    scheme: {} as Entry["scheme"],
    metrics: { cagr_5y: 0.1 } as unknown as Entry["metrics"],
    behaviour: {
      scheme_code: "X",
      category_key: null,
      min_drawdown_depth: 0.1,
      drawdowns: [],
      calendar_years: [],
      capture: { up: null, down: null, months: 0, reason: null },
      cost: {
        expense_ratio: null,
        category_median: null,
        category_count: 0,
        reason: null,
        horizon_years: 10,
        difference: null,
        shortfall_vs_median: null,
      },
      disclaimer: "",
      ...behaviour,
    } as Entry["behaviour"],
  };
}

describe("derive", () => {
  it("takes the worst fall from the first episode, which the API sorts worst first", () => {
    const row = derive(
      entry({
        drawdowns: [
          {
            peak_date: "2020-02-20",
            trough_date: "2020-03-23",
            depth: -0.29,
            recovered_date: "2020-08-26",
            days_to_trough: 32,
            days_to_recover: 188,
          },
        ],
      }),
    );

    expect(row["worst_fall"]).toBe(-0.29);
    expect(row["worst_fall_recovery_days"]).toBe(188);
    // The snapshot's own metrics stay reachable beside the derived ones.
    expect(row["cagr_5y"]).toBe(0.1);
  });

  it("reports an unrecovered fall as a null recovery rather than a zero", () => {
    const row = derive(
      entry({
        drawdowns: [
          {
            peak_date: "2024-01-01",
            trough_date: "2024-06-01",
            depth: -0.2,
            recovered_date: null,
            days_to_trough: 152,
            days_to_recover: null,
          },
        ],
      }),
    );

    expect(row["worst_fall_recovery_days"]).toBeNull();
  });

  it("counts only the years that have a peer return to compare against", () => {
    const row = derive(
      entry({
        calendar_years: [
          { year: 2022, fund_return: 0.1, months: 12, category_return: 0.05 },
          { year: 2023, fund_return: 0.1, months: 12, category_return: 0.2 },
          { year: 2024, fund_return: 0.3, months: 12, category_return: null },
        ],
      }),
    );

    expect(row["calendar_years_beaten_pct"]).toBe(0.5);
  });

  it("reports no beat rate at all when no year is comparable", () => {
    expect(derive(entry({})).calendar_years_beaten_pct).toBeNull();
  });
});
