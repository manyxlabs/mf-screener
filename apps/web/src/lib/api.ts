import {
  behaviourSchema,
  exposureSchema,
  basketResponseSchema,
  overlapResponseSchema,
  categoriesSchema,
  facetsSchema,
  columnsResponseSchema,
  comparisonResponseSchema,
  benchmarksResponseSchema,
  metadataSchema,
  methodologySchema,
  metricsSnapshotSchema,
  navResponseSchema,
  presetSchema,
  rollingResponseSchema,
  schemeDetailSchema,
  schemeListSchema,
  scoreResponseSchema,
  screenResponseSchema,
  searchResponseSchema,
} from "@mf/shared";
import { z } from "zod";

export const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:8000";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/**
 * Every response is validated before it reaches a component, so a shape change in
 * the API surfaces as one clear error instead of scattered undefined reads.
 */
async function request<T>(
  path: string,
  schema: z.ZodType<T>,
  init?: RequestInit & { revalidate?: number },
): Promise<T> {
  const { revalidate = 0, ...rest } = init ?? {};
  const response = await fetch(`${API_BASE}${path}`, {
    ...rest,
    next: { revalidate },
    headers: { Accept: "application/json", ...(rest.headers ?? {}) },
  });
  if (!response.ok) {
    let detail = response.statusText;
    try {
      const body = (await response.json()) as { detail?: string };
      if (body.detail) detail = body.detail;
    } catch {
      // a non-JSON error body is not worth a second failure
    }
    throw new ApiError(detail, response.status);
  }
  return schema.parse(await response.json());
}

export const getHealth = () =>
  request("/health", z.object({ status: z.string(), schemes: z.number(), disclaimer: z.string() }));

export const getMetadata = () => request("/metadata", metadataSchema);
export const getMethodology = () => request("/methodology", methodologySchema);
export const getColumns = () => request("/columns", columnsResponseSchema);
export const getPresets = () => request("/presets", z.array(presetSchema));
export const getCategories = () => request("/categories", categoriesSchema);
export const getFacets = () => request("/facets", facetsSchema);
export const getSchemeBehaviour = (code: string) =>
  request(`/schemes/${code}/behaviour`, behaviourSchema);
export const getSchemeExposure = (code: string) =>
  request(`/schemes/${code}/exposure`, exposureSchema);

// Defined here rather than in @mf/shared: only the fund page's style-drift chart calls
// this one query variant of /exposure, so a second exported type is not worth adding.
const rollingExposurePointSchema = z.object({
  end_date: z.string().nullable(),
  r_squared: z.number().nullable(),
  months: z.number(),
  weights: z
    .array(z.object({ benchmark_id: z.string(), benchmark_name: z.string(), weight: z.number() }))
    .nullable(),
  reason: z.string().nullable(),
});
export const rollingExposureSchema = z.object({
  scheme_code: z.string(),
  method: z.string(),
  window_months: z.number(),
  points: z.array(rollingExposurePointSchema),
  style_drift_3y: z.object({
    value: z.number().nullable(),
    n_obs: z.number(),
    reason: z.string().nullable(),
  }),
  basis: z.array(z.object({ benchmark_id: z.string(), benchmark_name: z.string() })),
  caveat: z.string(),
  disclaimer: z.string(),
});
export type RollingExposure = z.infer<typeof rollingExposureSchema>;
export const getSchemeRollingExposure = (code: string) =>
  request(`/schemes/${code}/exposure?rolling=true`, rollingExposureSchema);

// Defined here rather than in @mf/shared: this is the only caller, and the shape is a
// thin, endpoint-specific wrapper around a plain Metric rather than a reusable type.
const netReturnMetricSchema = z.object({
  value: z.number().nullable(),
  n_obs: z.number(),
  reason: z.string().nullable(),
  reason_description: z.string().nullable(),
});
export const netReturnsSchema = z.object({
  scheme_code: z.string(),
  horizon_years: z.number(),
  mode: z.enum(["lumpsum", "sip"]),
  clean_category: z.string(),
  clean_sub_category: z.string(),
  orientation: z.enum(["equity_oriented", "debt_oriented"]).nullable(),
  gross_return: netReturnMetricSchema,
  after_tax_return: netReturnMetricSchema,
  after_tax_and_load_return: netReturnMetricSchema,
  assumptions: z.object({
    ltcg_rate: z.number(),
    ltcg_exemption: z.number(),
    stcg_rate: z.number(),
    lt_holding_months: z.number(),
    slab_rate: z.number(),
    slab_rate_note: z.string(),
  }),
  disclaimer: z.string(),
});
export type NetReturns = z.infer<typeof netReturnsSchema>;
export const getSchemeNetReturns = (
  code: string,
  horizon: number,
  mode: "lumpsum" | "sip" = "lumpsum",
) => request(`/schemes/${code}/net-returns?horizon=${horizon}&mode=${mode}`, netReturnsSchema);
export const getBenchmarks = () => request("/benchmarks", benchmarksResponseSchema);

export const getScreen = (query: string) => request(`/screen?${query}`, screenResponseSchema);

export const getSchemes = (query: string) => request(`/schemes?${query}`, schemeListSchema);
export const searchSchemes = (q: string, limit = 8) =>
  request(`/search?q=${encodeURIComponent(q)}&limit=${limit}`, searchResponseSchema);
export const getScheme = (code: string) => request(`/schemes/${code}`, schemeDetailSchema);
export const getSchemeMetrics = (code: string) =>
  request(`/schemes/${code}/metrics`, metricsSnapshotSchema);
export const getSchemeNav = (code: string, frequency: "daily" | "monthly" = "monthly") =>
  request(`/schemes/${code}/nav?frequency=${frequency}`, navResponseSchema);
export const getRollingReturns = (code: string, horizon: number) =>
  request(`/schemes/${code}/rolling-returns?horizon=${horizon}`, rollingResponseSchema);
export const getComparison = (code: string, query = "") =>
  request(`/schemes/${code}/comparison?${query}`, comparisonResponseSchema);

export const getOverlap = (codes: string[]) =>
  request(`/overlap?codes=${encodeURIComponent(codes.join(","))}`, overlapResponseSchema);

export const postBasket = (scheme_codes: string[], weights?: number[]) =>
  request("/basket", basketResponseSchema, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(weights ? { scheme_codes, weights } : { scheme_codes }),
  });

export const exportCsvUrl = (query: string) => `${API_BASE}/export/csv?${query}`;

export const getScore = (code: string) => request(`/score/${code}`, scoreResponseSchema);
