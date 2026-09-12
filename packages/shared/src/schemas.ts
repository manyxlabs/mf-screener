import { z } from "zod";

/**
 * Every metric is nullable: a missing value is a first-class outcome, not an error.
 * It is not tolerant beyond that - a non-numeric, non-null value means the API
 * contract changed, and that should fail loudly rather than be swallowed.
 */
export const nullableNumber = z.number().nullable();

export const metricDirection = z.enum(["higher_is_better", "lower_is_better", "context"]);
export type MetricDirection = z.infer<typeof metricDirection>;

export const metricSpecSchema = z.object({
  name: z.string(),
  label: z.string(),
  unit: z.string(),
  definition: z.string(),
  period: z.string(),
  frequency: z.string(),
  direction: metricDirection,
  caveat: z.string(),
});
export type MetricSpec = z.infer<typeof metricSpecSchema>;

export const columnsResponseSchema = z.object({
  default: z.array(z.string()),
  selectable: z.array(z.string()),
  sortable: z.array(z.string()),
  metrics: z.array(metricSpecSchema),
  missing_reasons: z.record(z.string()),
});
export type ColumnsResponse = z.infer<typeof columnsResponseSchema>;

/** Row values are heterogeneous by design: the column set is chosen at request time. */
export const screenRowSchema = z.record(z.unknown());
export type ScreenRow = z.infer<typeof screenRowSchema>;

export const peerUniverseSchema = z.object({
  level: z.enum(["sub_category", "category"]),
  plan_scope: z.enum(["direct", "direct_regular", "all"]),
  option_scope: z.enum(["growth", "all"]),
  active_only: z.boolean(),
  aggregation: z.enum(["mean", "median"]),
  exclude_self: z.boolean(),
  min_peers: z.number(),
});
export type PeerUniverse = z.infer<typeof peerUniverseSchema>;

export const screenResponseSchema = z.object({
  total: z.number(),
  page: z.number(),
  page_size: z.number(),
  pages: z.number(),
  columns: z.array(z.string()),
  rows: z.array(screenRowSchema),
  methodology: z.object({
    as_of: z.string().nullable(),
    version: z.string(),
    peer_universe: peerUniverseSchema,
    risk_free_annual: z.number(),
    applied_filters: z.record(z.unknown()),
    sort: z.array(z.string()),
    note: z.string(),
    disclaimer: z.string(),
  }),
});
export type ScreenResponse = z.infer<typeof screenResponseSchema>;

export const schemeSchema = z.object({
  scheme_code: z.string(),
  scheme_name: z.string(),
  amc: z.string().nullable(),
  clean_category: z.string().nullable(),
  clean_sub_category: z.string().nullable(),
  clean_plan: z.string().nullable(),
  clean_option: z.string().nullable(),
  isin_growth: z.string().nullable(),
  isin_dividend: z.string().nullable(),
  is_active: z.boolean().nullable(),
  first_nav_date: z.string().nullable(),
  last_nav_date: z.string().nullable(),
  latest_nav: nullableNumber,
  latest_nav_date: z.string().nullable(),
  latest_aum: nullableNumber,
  aum_quarter: z.string().nullable(),
  fund_age_years: nullableNumber,
  expense_ratio: nullableNumber,
  fund_family_id: z.string().nullable(),
});
export type Scheme = z.infer<typeof schemeSchema>;

export const schemeVariantSchema = z.object({
  scheme_code: z.string(),
  scheme_name: z.string(),
  clean_plan: z.string().nullable(),
  clean_option: z.string().nullable(),
  is_active: z.boolean().nullable(),
  latest_aum: nullableNumber,
  expense_ratio: nullableNumber,
});
export type SchemeVariant = z.infer<typeof schemeVariantSchema>;

export const schemeVariantsResponseSchema = z.object({
  fund_family_id: z.string().nullable(),
  items: z.array(schemeVariantSchema),
});

export const schemeListSchema = z.object({
  total: z.number(),
  limit: z.number(),
  offset: z.number(),
  items: z.array(schemeSchema),
});

export const searchResultSchema = z.object({
  scheme_code: z.string(),
  scheme_name: z.string(),
  amc: z.string().nullable(),
  clean_sub_category: z.string().nullable(),
  clean_plan: z.string().nullable(),
  clean_option: z.string().nullable(),
});
export type SearchResult = z.infer<typeof searchResultSchema>;

export const searchResponseSchema = z.object({
  query: z.string(),
  items: z.array(searchResultSchema),
});
export type SearchResponse = z.infer<typeof searchResponseSchema>;

export const benchmarkSchema = z.object({
  benchmark_id: z.string(),
  benchmark_name: z.string(),
  currency: z.string(),
  source: z.string(),
  confidence: z.string().nullable(),
  notes: z.string().nullable(),
  /**
   * False when the benchmark is denominated in something other than the fund's own
   * currency. The API decides this, so no component has to compare currency strings
   * and none can accidentally present a USD index as a like-for-like comparison.
   */
  comparable_with_inr_funds: z.boolean(),
  fund_currency: z.string(),
});
export type Benchmark = z.infer<typeof benchmarkSchema>;

export const metricsUnavailableSchema = z.object({
  reason: z.string(),
  description: z.string(),
});

export const schemeDetailSchema = z.object({
  scheme: schemeSchema,
  benchmark: benchmarkSchema.nullable(),
  // Set only when the scheme has no metrics row at all, which is a fact about the fund
  // rather than a failure: AMFI lists schemes whose whole history is a terminal 0.00.
  metrics_unavailable: metricsUnavailableSchema.nullable(),
  // Oldest first. More than one entry means this fund changed peer group part-way
  // through the periods shown, so every peer-relative figure spans two comparisons.
  category_history: z.array(
    z.object({
      clean_category: z.string().nullable(),
      clean_sub_category: z.string().nullable(),
      valid_from: z.string(),
      valid_to: z.string().nullable(),
    }),
  ),
  disclaimer: z.string(),
});
export type SchemeDetail = z.infer<typeof schemeDetailSchema>;

export const metricsSnapshotSchema = z
  .object({
    scheme_code: z.string(),
    as_of_date: z.string(),
    benchmark_id: z.string().nullable(),
    category_key: z.string().nullable(),
    monthly_obs_count: z.number().nullable(),
    nav_gap_months: z.number().nullable(),
    data_quality_flags: z.array(z.string()),
    missing_reasons: z.record(z.string()),
    missing_reason_descriptions: z.record(z.string()),
    methodology_version: z.string(),
  })
  .passthrough();
export type MetricsSnapshot = z.infer<typeof metricsSnapshotSchema>;

export const rollingResponseSchema = z.object({
  scheme_code: z.string(),
  horizon_years: z.number(),
  /** Month-end where the NAV series changed scale; history before it is not comparable. */
  scale_break_at: z.string().nullable(),
  points: z.array(z.object({ date: z.string(), value: z.number() })),
  category_points: z.array(z.object({ date: z.string(), value: z.number() })),
  summary: z.object({
    mean: nullableNumber,
    median: nullableNumber,
    min: nullableNumber,
    max: nullableNumber,
    std: nullableNumber,
    positive_pct: nullableNumber,
    window_count: z.number(),
    reason: z.string().nullable(),
  }),
});
export type RollingResponse = z.infer<typeof rollingResponseSchema>;

export const comparisonHorizonSchema = z.object({
  fund_cagr: nullableNumber,
  category_return: nullableNumber,
  excess: nullableNumber,
  ratio: nullableNumber,
  ratio_reason: z.string().nullable(),
  peer_count: z.number(),
  reason: z.string().nullable(),
});

export const comparisonResponseSchema = z.object({
  scheme_code: z.string(),
  label: z.string(),
  universe: peerUniverseSchema,
  peer_universe_size: z.number(),
  horizons: z.record(comparisonHorizonSchema),
  peers: z.array(
    z.object({
      scheme_code: z.string(),
      scheme_name: z.string(),
      amc: z.string().nullable(),
      latest_aum: nullableNumber,
      fund_age_years: nullableNumber,
    }),
  ),
});
export type ComparisonResponse = z.infer<typeof comparisonResponseSchema>;

export const navResponseSchema = z.object({
  scheme_code: z.string(),
  frequency: z.string(),
  points: z.array(z.object({ date: z.string(), nav: z.number() })),
});

export const metadataSchema = z.object({
  counts: z.record(z.number()),
  coverage: z.object({
    first_nav_date: z.string().nullable(),
    last_nav_date: z.string().nullable(),
    latest_nav_date: z.string().nullable(),
    metrics_as_of: z.string().nullable(),
  }),
  benchmarks: z.array(
    z.object({
      benchmark_id: z.string(),
      benchmark_name: z.string(),
      currency: z.string(),
      source: z.string(),
      first_date: z.string().nullable(),
      last_date: z.string().nullable(),
      months: z.number(),
    }),
  ),
  ingest_log: z.array(z.record(z.unknown())),
  methodology_version: z.string(),
  default_universe: peerUniverseSchema,
  disclaimer: z.string(),
});
export type Metadata = z.infer<typeof metadataSchema>;

const benchmarkCoverageSchema = z.object({
  benchmark_id: z.string(),
  benchmark_name: z.string(),
  currency: z.string(),
  source: z.string(),
  asset_class: z.string(),
  first_date: z.string(),
  last_date: z.string(),
  months: z.number(),
  mapped_schemes: z.number(),
  is_proxy: z.boolean(),
  comparable_with_inr_funds: z.boolean(),
});
export type BenchmarkCoverage = z.infer<typeof benchmarkCoverageSchema>;

export const benchmarksResponseSchema = z.object({
  fund_currency: z.string(),
  currency_policy: z.string(),
  config_version: z.number().nullable(),
  mapping_rules: z.array(
    z.object({
      sub_category_contains: z.array(z.string()),
      scheme_name_contains: z.array(z.string()),
      benchmark_id: z.string(),
      fallback_benchmark_ids: z.array(z.string()),
      notes: z.string().nullable(),
    }),
  ),
  mapped_counts: z.array(
    z.object({
      benchmark_id: z.string(),
      confidence: z.string(),
      schemes: z.number(),
      example_sub_category: z.string().nullable(),
    }),
  ),
  benchmarks: z.array(benchmarkCoverageSchema),
  schemes_total: z.number(),
  schemes_mapped: z.number(),
  schemes_unmapped: z.number(),
  unmapped_by_sub_category: z.array(
    z.object({ clean_sub_category: z.string(), schemes: z.number() }),
  ),
  warnings: z.array(z.string()),
  disclaimer: z.string(),
});
export type BenchmarksResponse = z.infer<typeof benchmarksResponseSchema>;

export const presetSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  filters: z.object({
    search: z.string().optional(),
    categories: z.array(z.string()).optional(),
    sub_categories: z.array(z.string()).optional(),
    cap_bands: z.array(z.string()).optional(),
    styles: z.array(z.string()).optional(),
    plans: z.array(z.string()).optional(),
    options: z.array(z.string()).optional(),
    active_only: z.boolean().optional(),
    dedupe_families: z.boolean().optional(),
    ranges: z.record(z.number()),
  }),
  sort: z.string(),
  columns: z.array(z.string()),
  // Set only on the presets that are also a sleeve of the four-fund portfolio on /picks.
  slot: z.string().optional(),
  highlight: z.array(z.string()).optional(),
});
export type Preset = z.infer<typeof presetSchema>;

export const behaviourSchema = z.object({
  scheme_code: z.string(),
  category_key: z.string().nullable(),
  min_drawdown_depth: z.number(),
  drawdowns: z.array(
    z.object({
      peak_date: z.string(),
      trough_date: z.string(),
      depth: z.number(),
      recovered_date: z.string().nullable(),
      days_to_trough: z.number(),
      days_to_recover: z.number().nullable(),
    }),
  ),
  calendar_years: z.array(
    z.object({
      year: z.number(),
      fund_return: z.number(),
      months: z.number(),
      category_return: z.number().nullable(),
    }),
  ),
  capture_peer_basis: z.literal("leave_one_out_category_average"),
  capture_by_horizon: z.record(
    z.string(),
    z.object({
      up: z.number().nullable(),
      down: z.number().nullable(),
      reason: z.string().nullable(),
    }),
  ),
  capture: z.object({
    up: z.number().nullable(),
    down: z.number().nullable(),
    reason: z.string().nullable(),
    horizon_years: z.number(),
  }),
  cost: z.object({
    expense_ratio: z.number().nullable(),
    category_median: z.number().nullable(),
    category_count: z.number(),
    reason: z.string().nullable(),
    horizon_years: z.number(),
    difference: z.number().nullable(),
    shortfall_vs_median: z.number().nullable(),
  }),
  disclaimer: z.string(),
});
export type Behaviour = z.infer<typeof behaviourSchema>;

export const exposureSchema = z.object({
  scheme_code: z.string(),
  method: z.string(),
  weights: z.array(
    z.object({ benchmark_id: z.string(), benchmark_name: z.string(), weight: z.number() }),
  ),
  r_squared: z.number().nullable(),
  months: z.number(),
  first_date: z.string().nullable(),
  last_date: z.string().nullable(),
  reason: z.string().nullable(),
  basis: z.array(z.object({ benchmark_id: z.string(), benchmark_name: z.string() })),
  caveat: z.string(),
  disclaimer: z.string(),
});
export type Exposure = z.infer<typeof exposureSchema>;

export const facetsSchema = z.object({
  sub_categories: z.array(z.string()),
  cap_bands: z.array(z.string()),
  styles: z.array(z.string()),
  amcs: z.array(z.string()),
});
export type Facets = z.infer<typeof facetsSchema>;

export const categoriesSchema = z.object({
  items: z.array(
    z.object({
      clean_category: z.string().nullable(),
      clean_sub_category: z.string().nullable(),
      scheme_count: z.number(),
      direct_growth_active_count: z.number(),
    }),
  ),
});

const metricOutSchema = z.object({
  value: nullableNumber,
  n_obs: z.number(),
  reason: z.string().nullable(),
});

const basketComponentMetricsSchema = z.object({
  scheme_code: z.string(),
  weight: z.number(),
  cagr: metricOutSchema,
  volatility: metricOutSchema,
  sharpe: metricOutSchema,
  max_drawdown: metricOutSchema,
  capture_vs_blended: z.object({ up: metricOutSchema, down: metricOutSchema }),
});

/** The whole body is null-with-reason below the shared-history floor; only then are
 * `correlation_matrix`, `blended` and `components` absent. */
export const basketResponseSchema = z.object({
  scheme_codes: z.array(z.string()),
  weights: z.record(z.number()),
  min_observations: z.number(),
  matched_months: z.number(),
  reason: z.string().optional(),
  reason_description: z.string().optional(),
  correlation_matrix: z
    .array(z.object({ scheme_code: z.string(), correlations: z.record(z.number()) }))
    .optional(),
  blended: z
    .object({
      monthly_returns: z.array(z.object({ date: z.string(), value: z.number() })),
      cagr: metricOutSchema,
      volatility: metricOutSchema,
      sharpe: metricOutSchema,
      max_drawdown: metricOutSchema,
    })
    .optional(),
  diversification_benefit: metricOutSchema.optional(),
  components: z.array(basketComponentMetricsSchema).optional(),
  disclaimer: z.string(),
});
export type BasketResponse = z.infer<typeof basketResponseSchema>;

export const methodologySchema = z
  .object({
    version: z.string(),
    disclaimer: z.string(),
    frequency: z.record(z.string()),
    risk_free_rate: z.object({
      annual: z.number(),
      monthly: z.number(),
      conversion: z.string(),
      configurable_via: z.string(),
    }),
    month_end_rule: z.string(),
    formulas: z.record(z.string()),
    formula_notes: z.record(z.string()),
    peer_universe_default: peerUniverseSchema,
    peer_universe_rules: z.array(z.string()),
    minimum_observations: z.record(z.unknown()),
    benchmarks: z.record(z.string()),
    data_quality_reasons: z.record(z.string()),
    metric_catalog: z.array(metricSpecSchema),
    sources: z.record(z.string()),
    limitations: z.array(z.string()),
  })
  .passthrough();
export type Methodology = z.infer<typeof methodologySchema>;

/**
 * A percentile decomposition, not a rating: every field a caller needs to show
 * "why is this ranked above that" rather than a bare number.
 */
export const scoreComponentSchema = z.object({
  weight: z.number().nullable(),
  percentile: z.number().nullable(),
  contribution: z.number().nullable(),
  reason: z.string().nullable(),
  reason_description: z.string().nullable(),
});
export type ScoreComponent = z.infer<typeof scoreComponentSchema>;

export const scoreResponseSchema = z.object({
  scheme_code: z.string(),
  total: z.number().nullable(),
  status: z.enum(["complete", "partial"]),
  missing_components: z.array(z.string()),
  weights: z.record(z.number()),
  components: z.record(scoreComponentSchema),
  sub_category: z.string(),
  peer_count: z.number(),
  disclaimer: z.string(),
});
export type ScoreResponse = z.infer<typeof scoreResponseSchema>;
