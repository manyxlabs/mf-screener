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
  activeOnly: boolean;
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
  activeOnly: true,
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
  params.set("active_only", String(filters.activeOnly));
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
    activeOnly: preset.filters.active_only ?? base.activeOnly,
    dedupeFamilies: preset.filters.dedupe_families ?? base.dedupeFamilies,
    ranges: { ...preset.filters.ranges },
  };
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
