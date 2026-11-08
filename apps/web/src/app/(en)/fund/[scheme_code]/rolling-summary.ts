import { formatByUnit, type MetricSpec, type MetricsSnapshot } from "@mf/shared";
import type { I18n } from "@/lib/i18n/core";

/** One horizon's rolling-return spread: the figures behind a summary sentence. */
export type RollingSpread = {
  years: number;
  count: number;
  min: number;
  max: number;
  median: number;
  unit: string;
};

/**
 * A fund's 3 and 5-year rolling return spreads, empty when neither was computed. Read
 * on the server, so the figures are in the page's HTML for search engines; the sentence
 * is worded in the reader's language from them.
 */
export function rollingSpreads(
  metrics: MetricsSnapshot,
  specs: Map<string, MetricSpec>,
  horizons = [3, 5],
): RollingSpread[] {
  const record = metrics as unknown as Record<string, unknown>;
  return horizons.flatMap((years) => {
    const read = (stat: string) => {
      const value = record[`rolling_${years}y_${stat}`];
      return typeof value === "number" ? value : null;
    };
    const count = read("window_count");
    const min = read("min");
    const max = read("max");
    const median = read("median");
    if (!count || min === null || max === null || median === null) return [];
    // Min, max and median are one quantity, so they share a unit.
    const unit = specs.get(`rolling_${years}y_median`)?.unit ?? "percent";
    return [{ years, count, min, max, median, unit }];
  });
}

/** The spreads in plain sentences, or null when there are none. */
export function rollingSummary(spreads: RollingSpread[], { t, number }: I18n): string | null {
  const sentences = spreads.map(({ years, count, min, max, median, unit }) => {
    const pct = (value: number) => formatByUnit(value, unit, t.units);
    return t.fund.rollingSummary(number(count), years, pct(min), pct(max), pct(median));
  });
  return sentences.length ? sentences.join(" ") : null;
}
