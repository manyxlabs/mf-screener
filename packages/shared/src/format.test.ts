import { describe, expect, it } from "vitest";
import {
  MISSING,
  comparisonLabel,
  formatByUnit,
  formatCrore,
  formatDuration,
  formatPercent,
  formatPercentagePoints,
  formatRatio,
} from "./format";

describe("formatting", () => {
  it("renders returns as percentages to two decimals", () => {
    expect(formatPercent(0.12345)).toBe("12.35%");
    expect(formatPercent(-0.005)).toBe("-0.50%");
  });

  it("renders ratios to two decimals", () => {
    expect(formatRatio(1.2345)).toBe("1.23");
  });

  it("renders excess return in signed percentage points", () => {
    expect(formatPercentagePoints(0.0123)).toBe("+1.23 pp");
    expect(formatPercentagePoints(-0.0123)).toBe("-1.23 pp");
  });

  it("uses a plain dash for every missing value", () => {
    for (const fn of [formatPercent, formatRatio, formatPercentagePoints, formatCrore]) {
      expect(fn(null)).toBe(MISSING);
      expect(fn(undefined)).toBe(MISSING);
      expect(fn(Number.NaN)).toBe(MISSING);
    }
  });

  it("dispatches on unit", () => {
    expect(formatByUnit(0.1, "percent")).toBe("10.00%");
    expect(formatByUnit(1.5, "ratio")).toBe("1.50");
    expect(formatByUnit(null, "percent")).toBe(MISSING);
    expect(formatByUnit(true, "ratio")).toBe("Yes");
    expect(formatByUnit("Mid Cap Fund", "text")).toBe("Mid Cap Fund");
  });
});

describe("comparisonLabel", () => {
  it("pairs a marker with a word so colour is never the only signal", () => {
    expect(comparisonLabel(0.02, "higher_is_better")).toMatchObject({
      tone: "good",
      label: "above",
    });
    expect(comparisonLabel(-0.02, "higher_is_better")).toMatchObject({
      tone: "bad",
      label: "below",
    });
    expect(comparisonLabel(0.02, "lower_is_better")).toMatchObject({ tone: "bad" });
    expect(comparisonLabel(null, "higher_is_better")).toMatchObject({ tone: "neutral" });
    expect(comparisonLabel(0.5, "context")).toMatchObject({ tone: "neutral" });
  });
});

describe("formatDuration", () => {
  it("uses the coarsest unit that still reads precisely", () => {
    expect(formatDuration(12)).toBe("12 d");
    expect(formatDuration(188)).toBe("6 mo");
    expect(formatDuration(603)).toBe("1.7 yr");
  });

  it("does not call 30 days a month before it is one", () => {
    expect(formatDuration(29)).toBe("29 d");
    expect(formatDuration(31)).toBe("1 mo");
  });
});
