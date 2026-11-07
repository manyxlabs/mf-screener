import type { Behaviour, MetricSpec, MetricsSnapshot, Scheme } from "@mf/shared";
import type { Messages } from "@/messages/en";

export const MAX_FUNDS = 5;

export type Entry = { scheme: Scheme; metrics: MetricsSnapshot; behaviour: Behaviour };

type Derived = Messages["compare"]["derived"];

const DERIVED: Record<keyof Derived, [unit: string, MetricSpec["direction"], group: string]> = {
  worst_fall: ["percent", "higher_is_better", "Drawdown"],
  worst_fall_recovery_days: ["days", "lower_is_better", "Drawdown"],
  up_capture: ["ratio", "higher_is_better", "Risk"],
  down_capture: ["ratio", "lower_is_better", "Risk"],
  calendar_years_beaten_pct: ["percent", "higher_is_better", "Vs similar funds"],
};

/**
 * Computed live from NAV rather than read from the snapshot, so they are present for a
 * fund too young to have one. Their specs live here because no stored column matches
 * them, and their wording in the site's catalogue for the same reason.
 */
export const derivedSpecs = (t: Messages): Record<string, MetricSpec> =>
  Object.fromEntries(
    Object.entries(DERIVED).map(([name, [unit, direction, group]]) => {
      const { label, definition, caveat } = t.compare.derived[name as keyof Derived];
      const spec: MetricSpec = {
        name,
        label,
        unit,
        direction,
        definition,
        caveat,
        period: t.compare.wholeHistory,
        frequency: unit === "days" || name === "worst_fall" ? "daily" : "monthly",
        // Written in plain language to begin with, so the beginner-facing fields the
        // catalogue carries are the same strings rather than a second wording.
        plain_label: label,
        plain_definition: definition,
        group,
      };
      return [name, spec];
    }),
  );

export function derive(entry: Entry): Record<string, unknown> {
  const worst = entry.behaviour.drawdowns[0] ?? null;
  const comparable = entry.behaviour.calendar_years.filter((y) => y.category_return !== null);
  const beaten = comparable.filter((y) => y.fund_return > y.category_return!).length;
  return {
    ...(entry.metrics as unknown as Record<string, unknown>),
    worst_fall: worst?.depth ?? null,
    worst_fall_recovery_days: worst?.days_to_recover ?? null,
    up_capture: entry.behaviour.capture.up,
    down_capture: entry.behaviour.capture.down,
    calendar_years_beaten_pct: comparable.length ? beaten / comparable.length : null,
  };
}

/** Which columns hold the best and the worst value in one row, or none if it is not a contest. */
export function extremes(values: (number | null)[], direction: MetricSpec["direction"]) {
  const numbers = values.filter((v): v is number => v !== null);
  // A context metric has no better end, and two identical values are not a ranking.
  if (direction === "context" || numbers.length < 2) return { best: null, worst: null };
  const high = Math.max(...numbers);
  const low = Math.min(...numbers);
  if (high === low) return { best: null, worst: null };
  return direction === "lower_is_better" ? { best: low, worst: high } : { best: high, worst: low };
}
