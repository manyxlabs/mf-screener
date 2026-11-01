/**
 * POST /basket computed in the browser from the static export, answering exactly as the
 * API does: the same validation errors, the same refusals and the same figures. Mirrors
 * `basket` in apps/api/mf_api/main.py and `compute_basket` in mf_analytics.metrics.basket.
 */
import type { BasketResponse } from "@mf/shared";
import { z } from "zod";
import { ApiError } from "./api";
import { loadFund, loadJson, loadScreenColumn } from "./static-data";

// BasketRequest in main.py, and MIN_OBS / ZERO_TOLERANCE in mf_analytics, which no
// export carries.
const MAX_FUNDS = 10;
const WEIGHT_TOLERANCE = 1e-6;
const MIN_OBS = 24;
const ZERO_TOLERANCE = 1e-12;
const ANNUALISATION = Math.sqrt(12);

const returnsSchema = z.object({
  dates: z.array(z.string()),
  values: z.array(z.number().nullable()),
});
const metadataSchema = z.object({ disclaimer: z.string() });
const methodologySchema = z.object({
  risk_free_rate: z.object({ annual: z.number() }),
  data_quality_reasons: z.object({ insufficient_history: z.string() }),
});

type Metric = { value: number | null; n_obs: number; reason: string | null };
const metric = (value: number, n: number): Metric => ({ value, n_obs: n, reason: null });
const missing = (reason: string, n: number): Metric => ({ value: null, n_obs: n, reason });

/** The first error FastAPI's 422 would list, in pydantic's order and wording. */
function invalidRequest(codes: string[], weights?: number[]): string | null {
  if (codes.length < 1) return "List should have at least 1 item after validation, not 0";
  if (codes.length > MAX_FUNDS)
    return `List should have at most ${MAX_FUNDS} items after validation, not ${codes.length}`;
  if (new Set(codes).size !== codes.length) return "Value error, scheme_codes must not repeat";
  if (!weights) return null;
  // JSON carries NaN and Infinity as null, which pydantic refuses as a float.
  if (!weights.every(Number.isFinite)) return "Input should be a valid number";
  if (weights.length !== codes.length)
    return "Value error, weights must have one entry per scheme_code";
  if (weights.some((w) => w < 0)) return "Value error, weights must be non-negative";
  if (Math.abs(sum(weights) - 1) > WEIGHT_TOLERANCE) return "Value error, weights must sum to 1";
  return null;
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const mean = (xs: number[]) => sum(xs) / xs.length;
const product = (xs: number[]) => xs.reduce((a, b) => a * (1 + b), 1);

function std(xs: number[]): number {
  const m = mean(xs);
  return Math.sqrt(sum(xs.map((x) => (x - m) ** 2)) / (xs.length - 1));
}

function correlation(xs: number[], ys: number[]): number {
  const mx = mean(xs);
  const my = mean(ys);
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  xs.forEach((x, i) => {
    const dx = x - mx;
    const dy = ys[i]! - my;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  });
  return sxy / Math.sqrt(sxx * syy);
}

/** CAGR, volatility, Sharpe and max drawdown over the whole matched window. */
function fullPeriod(r: number[], rfMonthly: number) {
  const n = r.length;
  let level = 1;
  let peak = -Infinity;
  let worst = Infinity;
  for (const x of r) {
    level *= 1 + x;
    const nav = level * 100;
    peak = Math.max(peak, nav);
    worst = Math.min(worst, nav / peak - 1);
  }
  const sd = std(r);
  return {
    cagr: metric(((level * 100) / 100) ** (1 / (n / 12)) - 1, n),
    volatility: metric(sd * ANNUALISATION, n),
    sharpe:
      sd <= ZERO_TOLERANCE
        ? missing("zero_or_invalid_denominator", n)
        : metric((mean(r.map((x) => x - rfMonthly)) / sd) * ANNUALISATION, n),
    max_drawdown: metric(worst, n),
  };
}

/** risk.capture_ratios(fund, comparison) over months already matched. */
function capture(fund: number[], comparison: number[], up: boolean): Metric {
  const months = comparison.flatMap((c, i) => ((up ? c > 0 : c < 0) ? [i] : []));
  if (months.length === 0) return missing("no_overlapping_observations", 0);
  const c = product(months.map((i) => comparison[i]!)) - 1;
  if (Math.abs(c) <= ZERO_TOLERANCE) return missing("zero_or_invalid_denominator", months.length);
  return metric((product(months.map((i) => fund[i]!)) - 1) / c, months.length);
}

export async function basket(codes: string[], weights?: number[]): Promise<BasketResponse> {
  const invalid = invalidRequest(codes, weights);
  if (invalid) throw new ApiError(invalid, 422);
  // The export carries a fund file for every active scheme and nothing else.
  const known = new Set((await loadScreenColumn("scheme_code")) as string[]);
  const unknown = codes.find((code) => !known.has(code));
  if (unknown !== undefined) throw new ApiError(`Unknown scheme_code '${unknown}'`, 404);

  const [metadata, methodology, ...bundles] = await Promise.all([
    loadJson("global/metadata.json").then((m) => metadataSchema.parse(m)),
    loadJson("global/methodology.json").then((m) => methodologySchema.parse(m)),
    ...codes.map(loadFund),
  ]);
  const weightOf = Object.fromEntries(
    codes.map((code, i) => [code, weights ? weights[i]! : 1 / codes.length]),
  );
  const series = new Map(
    codes.map((code, i) => {
      const { dates, values } = returnsSchema.parse(bundles[i]!.monthly_returns);
      const byDate = new Map<string, number>();
      dates.forEach((date, j) => values[j] != null && byDate.set(date, values[j]));
      return [code, byDate];
    }),
  );

  const all = [...series.values()];
  const dates = [...all[0]!.keys()].filter((d) => all.every((s) => s.has(d))).sort();
  const n = dates.length;
  const head = { scheme_codes: codes, weights: weightOf, min_observations: MIN_OBS };
  if (n < MIN_OBS) {
    return {
      ...head,
      matched_months: n,
      reason: "insufficient_history",
      reason_description: methodology.data_quality_reasons.insufficient_history,
      disclaimer: metadata.disclaimer,
    };
  }

  const rfMonthly = (1 + methodology.risk_free_rate.annual) ** (1 / 12) - 1;
  // The API reads its members ORDER BY scheme_code, which sets the matrix and component order.
  const columns = [...codes].sort();
  const matched = new Map(columns.map((c) => [c, dates.map((d) => series.get(c)!.get(d)!)]));
  const blended = dates.map((_, i) => sum(columns.map((c) => matched.get(c)![i]! * weightOf[c]!)));
  const blend = fullPeriod(blended, rfMonthly);
  const components = columns.map((code) => {
    const own = matched.get(code)!;
    return {
      scheme_code: code,
      weight: weightOf[code]!,
      ...fullPeriod(own, rfMonthly),
      capture_vs_blended: { up: capture(blended, own, true), down: capture(blended, own, false) },
    };
  });
  const weightedVol = sum(components.map((c) => c.weight * c.volatility.value!));

  return {
    ...head,
    matched_months: n,
    correlation_matrix: columns.map((row) => ({
      scheme_code: row,
      correlations: Object.fromEntries(
        columns.map((col) => [col, correlation(matched.get(row)!, matched.get(col)!)]),
      ),
    })),
    blended: {
      monthly_returns: dates.map((date, i) => ({ date, value: blended[i]! })),
      ...blend,
    },
    diversification_benefit: metric(weightedVol - blend.volatility.value!, n),
    components,
    disclaimer: metadata.disclaimer,
  };
}
