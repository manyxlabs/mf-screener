import type { Preset } from "@mf/shared";

export type ScreenFilters = {
  page: number;
  pageSize: number;
  search: string;
  sort: string;
  columns: string[];
  subCategories: string[];
  capBands: string[];
  styles: string[];
  amcs: string[];
  plans: string[];
  options: string[];
  dedupeFamilies: boolean;
  ranges: Record<string, number>;
};

export const DEFAULT_FILTERS: ScreenFilters = {
  page: 1,
  pageSize: 50,
  search: "",
  sort: "cagr_5y:desc",
  columns: [],
  subCategories: [],
  capBands: [],
  styles: [],
  amcs: [],
  plans: ["Direct"],
  options: ["Growth"],
  dedupeFamilies: true,
  ranges: {},
};

/** Serialises filters exactly the way `/screen` and `/export/csv` both parse them. */
export function toQueryString(filters: ScreenFilters, options?: { omitPaging?: boolean }): string {
  const params = new URLSearchParams();
  if (!options?.omitPaging) {
    params.set("page", String(filters.page));
    params.set("page_size", String(filters.pageSize));
  }
  if (filters.search.trim()) params.set("search", filters.search.trim());
  if (filters.sort) params.set("sort", filters.sort);
  if (filters.columns.length) params.set("columns", filters.columns.join(","));
  for (const value of filters.subCategories) params.append("sub_category", value);
  for (const value of filters.capBands) params.append("cap_band", value);
  for (const value of filters.styles) params.append("style", value);
  for (const value of filters.amcs) params.append("amc", value);
  for (const value of filters.plans) params.append("plan", value);
  for (const value of filters.options) params.append("option", value);
  params.set("dedupe_families", String(filters.dedupeFamilies));
  for (const [key, value] of Object.entries(filters.ranges)) {
    if (value !== null && value !== undefined && !Number.isNaN(value)) {
      params.set(key, String(value));
    }
  }
  return params.toString();
}

export function presetToFilters(
  preset: Preset,
  base: ScreenFilters = DEFAULT_FILTERS,
): ScreenFilters {
  return {
    ...base,
    page: 1,
    search: preset.filters.search ?? "",
    sort: preset.sort,
    columns: preset.columns,
    subCategories: preset.filters.sub_categories ?? [],
    capBands: preset.filters.cap_bands ?? [],
    styles: preset.filters.styles ?? [],
    amcs: [],
    plans: preset.filters.plans ?? base.plans,
    options: preset.filters.options ?? base.options,
    dedupeFamilies: preset.filters.dedupe_families ?? base.dedupeFamilies,
    ranges: { ...preset.filters.ranges },
  };
}

/**
 * Whether a screen still stands on exactly one preset's rules. Derived rather than
 * remembered, so editing any rule drops the preset label instead of leaving a card that
 * describes a screen the user has since changed. Sort and columns are the user's to move.
 */
export function matchesPreset(preset: Preset, filters: ScreenFilters): boolean {
  const rules = presetToFilters(preset, filters);
  const same = (a: string[], b: string[]) =>
    a.length === b.length && a.every((value, index) => value === b[index]);
  return (
    rules.search === filters.search &&
    same(rules.subCategories, filters.subCategories) &&
    same(rules.capBands, filters.capBands) &&
    same(rules.styles, filters.styles) &&
    same(rules.plans, filters.plans) &&
    same(rules.options, filters.options) &&
    rules.dedupeFamilies === filters.dedupeFamilies &&
    JSON.stringify(rules.ranges) === JSON.stringify(filters.ranges)
  );
}

/** Multi-column sort tokens, kept in the order the user clicked them. */
export function toggleSort(sort: string, column: string, additive: boolean): string {
  const tokens = sort ? sort.split(",").filter(Boolean) : [];
  const index = tokens.findIndex((t) => t.split(":")[0] === column);
  const current = index >= 0 ? tokens[index]!.split(":")[1] : undefined;
  const next = current === "desc" ? "asc" : "desc";
  const token = `${column}:${next}`;
  if (!additive) return token;
  if (index >= 0) {
    const copy = [...tokens];
    copy[index] = token;
    return copy.join(",");
  }
  return [...tokens, token].join(",");
}

export function sortDirection(sort: string, column: string): "asc" | "desc" | null {
  const token = sort.split(",").find((t) => t.split(":")[0] === column);
  if (!token) return null;
  return token.split(":")[1] === "asc" ? "asc" : "desc";
}

/**
 * Renders a sort token as a sentence. `rolling_5y_median:desc` is the machine's
 * spelling of the sort, not a reader's, and it was being printed verbatim above the
 * results. Falls back to the raw token for a column the metric catalogue does not
 * carry, so an unknown sort degrades to today's output rather than to nothing.
 */
export function describeSort(
  sort: string,
  labelOf: (column: string) => string | undefined,
): string {
  const parts = sort
    .split(",")
    .filter(Boolean)
    .map((token) => {
      const [column = "", direction] = token.split(":");
      const label = labelOf(column);
      if (!label) return token;
      return `${label}, ${direction === "asc" ? "lowest first" : "highest first"}`;
    });
  return parts.join(", then ");
}
