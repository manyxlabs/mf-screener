import type { Behaviour, MetricSpec, MetricsSnapshot, Scheme } from "@mf/shared";

export const MAX_FUNDS = 5;

export type Entry = { scheme: Scheme; metrics: MetricsSnapshot; behaviour: Behaviour };

function spec(
  name: string,
  label: string,
  unit: string,
  direction: MetricSpec["direction"],
  definition: string,
  caveat: string,
  group: string,
): MetricSpec {
  return {
    name,
    label,
    unit,
    direction,
    definition,
    caveat,
    period: "whole stored history",
    frequency: name === "worst_fall" || name === "worst_fall_recovery_days" ? "daily" : "monthly",
    // These five were written in plain language to begin with, so the beginner-facing
    // fields the catalogue carries are the same strings rather than a second wording.
    plain_label: label,
    plain_definition: definition,
    group,
  };
}

// Computed live from NAV rather than read from the snapshot, so they are present for a
// fund too young to have one. Their specs live here because no stored column matches them.
export const DERIVED_SPECS: Record<string, MetricSpec> = {
  worst_fall: spec(
    "worst_fall",
    "Worst fall",
    "percent",
    "higher_is_better",
    "Deepest peak-to-trough fall in daily NAV over the whole stored history.",
    "Carried as a negative number, so a smaller fall is the higher value. It covers the fund's own history only, which for a young fund may contain no correction at all.",
    "Drawdown",
  ),
  worst_fall_recovery_days: spec(
    "worst_fall_recovery_days",
    "Time to recover from it",
    "days",
    "lower_is_better",
    "Calendar days from the pre-fall high to the day that high was regained.",
    "Blank when the fund has not yet regained that high, which is worse than any number here, not better.",
    "Drawdown",
  ),
  up_capture: spec(
    "up_capture",
    "Up capture",
    "ratio",
    "higher_is_better",
    "Compounded fund return over the months its sub-category rose, divided by the sub-category's own return over those months.",
    "Measured against the equal-weighted peer return, not a benchmark index.",
    "Risk",
  ),
  down_capture: spec(
    "down_capture",
    "Down capture",
    "ratio",
    "lower_is_better",
    "The same ratio over the months the sub-category fell. Below 1 means the fund fell less than its peers.",
    "A fund can score well here simply by holding cash, which costs it on the up side.",
    "Risk",
  ),
  calendar_years_beaten_pct: spec(
    "calendar_years_beaten_pct",
    "Calendar years beating peers",
    "percent",
    "higher_is_better",
    "Share of complete and partial calendar years in which the fund beat its sub-category.",
    "A young fund is judged on very few years, so read it beside the fund's age.",
    "Vs similar funds",
  ),
};

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
