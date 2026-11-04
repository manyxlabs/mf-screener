import { formatByUnit, type MetricSpec, type MetricsSnapshot } from "@mf/shared";

/**
 * A fund's 3 and 5-year rolling returns in plain sentences, or null when neither was
 * computed. Built on the server, so the figures are in the page's HTML for search engines.
 */
export function rollingSummary(
  metrics: MetricsSnapshot,
  specs: Map<string, MetricSpec>,
  horizons = [3, 5],
): string | null {
  const record = metrics as unknown as Record<string, unknown>;
  const sentences = horizons.flatMap((years) => {
    const read = (stat: string) => {
      const value = record[`rolling_${years}y_${stat}`];
      return typeof value === "number" ? value : null;
    };
    const count = read("window_count");
    const min = read("min");
    const max = read("max");
    const median = read("median");
    if (!count || min === null || max === null || median === null) return [];
    const pct = (stat: string, value: number) =>
      formatByUnit(value, specs.get(`rolling_${years}y_${stat}`)?.unit ?? "percent");
    return [
      `Over ${count} rolling ${years}-year windows the return ranged from ${pct("min", min)} ` +
        `to ${pct("max", max)} a year, with a median of ${pct("median", median)}.`,
    ];
  });
  return sentences.length ? sentences.join(" ") : null;
}
