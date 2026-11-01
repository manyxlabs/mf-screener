import {
  behaviourSchema,
  exposureSchema,
  basketResponseSchema,
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
  screenResponseSchema,
  searchResponseSchema,
} from "@mf/shared";
import { z } from "zod";
import { ApiError } from "./api-error";
import { basket } from "./static-basket";
import { loadJson } from "#static-data";
import type { FundBundle } from "./static-data";
import { exportCsv, listSchemes, screen, search } from "./static-screen";

export { ApiError };

// Server components run once, at build time, and read public/data from disk; the
// browser fetches the same files. package.json maps `#static-data` to the disk reader
// under the react-server condition, so it never reaches a client chunk.

/**
 * Every answer is validated before it reaches a component, so a shape change in the
 * export surfaces as one clear error instead of scattered undefined reads.
 */
const global = async <T>(name: string, schema: z.ZodType<T>) =>
  schema.parse(await loadJson(`global/${name}.json`));

const refusalSchema = z.object({ error: z.number(), detail: z.string().nullable() });

/** One key of a fund's bundle; a key the API refused throws as that refusal did. */
async function fundPart<T>(code: string, key: string, schema: z.ZodType<T>): Promise<T> {
  const bundle = await loadJson<FundBundle>(`fund/${code}.json`).catch((error: unknown) => {
    // The build only renders codes that have a file, so a miss there is a real fault.
    // In the browser it is a code that was never exported: the API's 404.
    if (typeof window === "undefined" || error instanceof TypeError) throw error;
    throw new ApiError(`No published data for scheme ${code}`, 404);
  });
  const part = bundle[key];
  const refused = refusalSchema.safeParse(part);
  if (refused.success) {
    const { error, detail } = refused.data;
    throw new ApiError(detail ?? `HTTP ${error}`, error);
  }
  return schema.parse(part);
}

export const getMetadata = () => global("metadata", metadataSchema);
export const getMethodology = () => global("methodology", methodologySchema);
export const getColumns = () => global("columns", columnsResponseSchema);
export const getPresets = () => global("presets", z.array(presetSchema));
export const getCategories = () => global("categories", categoriesSchema);
export const getFacets = () => global("facets", facetsSchema);
export const getBenchmarks = () => global("benchmarks", benchmarksResponseSchema);

export const ROLLING_HORIZONS = [1, 3, 5, 10] as const;
export type RollingHorizon = (typeof ROLLING_HORIZONS)[number];

export const getScheme = (code: string) => fundPart(code, "scheme", schemeDetailSchema);
export const getSchemeMetrics = (code: string) => fundPart(code, "metrics", metricsSnapshotSchema);
export const getSchemeNav = (code: string) => fundPart(code, "nav", navResponseSchema);
export const getRollingReturns = (code: string, horizon: RollingHorizon) =>
  fundPart(code, `rolling_${horizon}`, rollingResponseSchema);
export const getSchemeBehaviour = (code: string) => fundPart(code, "behaviour", behaviourSchema);
export const getSchemeExposure = (code: string) => fundPart(code, "exposure", exposureSchema);
export const getComparison = (code: string) =>
  fundPart(code, "comparison", comparisonResponseSchema);

// Defined here rather than in @mf/shared: only the fund page's style-drift chart reads
// this variant of /exposure, so a second exported type is not worth adding.
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
  fundPart(code, "exposure_rolling", rollingExposureSchema);

// Third-party facts per docs/data-policy.md, not computed from NAV, so not in @mf/shared
// beside the metric schemas.
const attributeCellSchema = z.object({
  value: z.union([z.string(), z.number(), z.boolean()]).nullable(),
  as_of: z.string().nullable(),
  stale: z.boolean(),
  reason: z.string().nullable(),
  reason_description: z.string().nullable(),
});
const schemeAttributesSchema = z.object({
  scheme_code: z.string(),
  fields: z.record(z.string(), attributeCellSchema),
  source: z.string().nullable(),
  source_url: z.string().nullable(),
  disclaimer: z.string(),
});
export type SchemeAttributes = z.infer<typeof schemeAttributesSchema>;
export type AttributeCell = z.infer<typeof attributeCellSchema>;
/** Null when no source has published attributes for the scheme. */
export const getSchemeAttributes = (code: string) =>
  fundPart(code, "attributes", schemeAttributesSchema).catch((error: unknown) => {
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  });

export const getScreen = async (query: string) => screenResponseSchema.parse(await screen(query));
export const getSchemes = async (query: string) => schemeListSchema.parse(await listSchemes(query));
export const searchSchemes = async (q: string, limit = 8) =>
  searchResponseSchema.parse(await search(q, limit));
export const postBasket = async (codes: string[], weights?: number[]) =>
  basketResponseSchema.parse(await basket(codes, weights));
export { exportCsv };
