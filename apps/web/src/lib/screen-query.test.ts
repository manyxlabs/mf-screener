import type { Preset } from "@mf/shared";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_FILTERS,
  presetToFilters,
  sortDirection,
  toQueryString,
  toggleSort,
} from "./screen-query";

describe("toQueryString", () => {
  it("defaults to the active Direct Growth universe", () => {
    const params = new URLSearchParams(toQueryString(DEFAULT_FILTERS));
    expect(params.getAll("plan")).toEqual(["Direct"]);
    expect(params.getAll("option")).toEqual(["Growth"]);
    expect(params.get("active_only")).toBe("true");
    // T2.1: the screener asks for one row per fund unless told otherwise.
    expect(params.get("dedupe_families")).toBe("true");
  });

  it("repeats multi-value filters instead of joining them", () => {
    const query = toQueryString({
      ...DEFAULT_FILTERS,
      subCategories: ["Mid Cap Fund", "Small Cap Fund"],
      amcs: ["HDFC Mutual Fund"],
    });
    expect(new URLSearchParams(query).getAll("sub_category")).toEqual([
      "Mid Cap Fund",
      "Small Cap Fund",
    ]);
    expect(new URLSearchParams(query).getAll("amc")).toEqual(["HDFC Mutual Fund"]);
  });

  it("emits range bounds under the names the API parses", () => {
    const query = toQueryString({
      ...DEFAULT_FILTERS,
      ranges: { cagr_5y_min: 0.12, max_drawdown_5y_max: -0.1 },
    });
    const params = new URLSearchParams(query);
    expect(params.get("cagr_5y_min")).toBe("0.12");
    expect(params.get("max_drawdown_5y_max")).toBe("-0.1");
  });

  it("omits paging for the export request so the whole result set is written", () => {
    const query = toQueryString(DEFAULT_FILTERS, { omitPaging: true });
    expect(new URLSearchParams(query).has("page")).toBe(false);
    expect(new URLSearchParams(query).has("page_size")).toBe(false);
  });

  it("drops an empty search term rather than sending a blank filter", () => {
    expect(
      new URLSearchParams(toQueryString({ ...DEFAULT_FILTERS, search: "   " })).has("search"),
    ).toBe(false);
  });
});

describe("toggleSort", () => {
  it("flips direction on the same column", () => {
    expect(toggleSort("cagr_5y:desc", "cagr_5y", false)).toBe("cagr_5y:asc");
    expect(toggleSort("cagr_5y:asc", "cagr_5y", false)).toBe("cagr_5y:desc");
  });

  it("replaces the sort unless shift is held", () => {
    expect(toggleSort("cagr_5y:desc", "sharpe_5y", false)).toBe("sharpe_5y:desc");
  });

  it("appends a secondary sort when additive", () => {
    expect(toggleSort("cagr_5y:desc", "sharpe_5y", true)).toBe("cagr_5y:desc,sharpe_5y:desc");
  });

  it("updates an existing token in place, keeping its priority", () => {
    expect(toggleSort("cagr_5y:desc,sharpe_5y:desc", "cagr_5y", true)).toBe(
      "cagr_5y:asc,sharpe_5y:desc",
    );
  });

  it("reports the current direction of a column", () => {
    expect(sortDirection("cagr_5y:desc,sharpe_5y:asc", "sharpe_5y")).toBe("asc");
    expect(sortDirection("cagr_5y:desc", "beta_5y")).toBeNull();
  });
});

describe("presetToFilters", () => {
  const preset: Preset = {
    id: "mid-cap-consistency",
    name: "Mid cap",
    description: "",
    filters: {
      sub_categories: ["Mid Cap Fund"],
      plans: ["Direct"],
      options: ["Growth"],
      active_only: true,
      ranges: { fund_age_years_min: 7, fund_minus_category_5y_min: 0 },
    },
    sort: "rolling_5y_median:desc",
    columns: ["scheme_name", "cagr_5y"],
  };

  it("carries every part of the preset into a runnable screen", () => {
    const filters = presetToFilters(preset);
    expect(filters.subCategories).toEqual(["Mid Cap Fund"]);
    expect(filters.ranges["fund_age_years_min"]).toBe(7);
    expect(filters.sort).toBe("rolling_5y_median:desc");
    expect(filters.columns).toEqual(["scheme_name", "cagr_5y"]);
    expect(filters.page).toBe(1);
  });

  it("copies the ranges so editing the screen cannot mutate the preset", () => {
    const filters = presetToFilters(preset);
    filters.ranges["fund_age_years_min"] = 10;
    expect(preset.filters.ranges["fund_age_years_min"]).toBe(7);
  });
});
