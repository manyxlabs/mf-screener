/** Display formatting. A null is always an em-free dash with an explanation elsewhere. */
export const MISSING = "-";

/** The words the formatters attach to a figure, which each language supplies its own of. */
export type UnitWords = {
  crore: string;
  year: string;
  month: string;
  day: string;
  pp: string;
  yes: string;
  no: string;
};

export const EN_UNITS: UnitWords = {
  crore: "Cr",
  year: "yr",
  month: "mo",
  day: "d",
  pp: "pp",
  yes: "Yes",
  no: "No",
};

export function formatPercent(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || Number.isNaN(value)) return MISSING;
  return `${(value * 100).toFixed(digits)}%`;
}

export function formatRatio(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || Number.isNaN(value)) return MISSING;
  return value.toFixed(digits);
}

export function formatPercentagePoints(
  value: number | null | undefined,
  digits = 2,
  words = EN_UNITS,
): string {
  if (value === null || value === undefined || Number.isNaN(value)) return MISSING;
  const sign = value > 0 ? "+" : "";
  return `${sign}${(value * 100).toFixed(digits)} ${words.pp}`;
}

// Every Indian locale groups digits the same lakh-crore way, so en-IN serves them all.
export function formatCrore(value: number | null | undefined, words = EN_UNITS): string {
  if (value === null || value === undefined || Number.isNaN(value)) return MISSING;
  return `${value.toLocaleString("en-IN", { maximumFractionDigits: 0 })} ${words.crore}`;
}

export function formatYears(value: number | null | undefined, words = EN_UNITS): string {
  if (value === null || value === undefined || Number.isNaN(value)) return MISSING;
  return `${value.toFixed(1)} ${words.year}`;
}

export function pluralise(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

export function formatCount(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return MISSING;
  return `n=${value}`;
}

export type Unit = "percent" | "ratio" | "percentage_points" | "inr_crore" | "inr" | "years";

/** A span of days at the coarsest unit that still reads precisely: 12 d, 6 mo, 1.6 yr. */
export function formatDuration(days: number, words = EN_UNITS): string {
  const months = days / 30.44;
  if (months >= 12) return `${(months / 12).toFixed(1)} ${words.year}`;
  if (months >= 1) return `${Math.round(months)} ${words.month}`;
  return `${Math.round(days)} ${words.day}`;
}

export function formatByUnit(value: unknown, unit: string, words = EN_UNITS): string {
  if (value === null || value === undefined) return MISSING;
  if (typeof value === "boolean") return value ? words.yes : words.no;
  if (typeof value !== "number") return String(value);
  switch (unit) {
    case "percent":
      return formatPercent(value);
    case "percentage_points":
      return formatPercentagePoints(value, 2, words);
    case "ratio":
      return formatRatio(value);
    case "inr_crore":
      return formatCrore(value, words);
    case "inr":
      return value.toLocaleString("en-IN", { maximumFractionDigits: 4 });
    case "years":
      return formatYears(value, words);
    case "days":
      return formatDuration(value, words);
    case "score":
      // One decimal: the score is a blend of percentiles, and the digits past it are
      // precision the inputs do not have.
      return value.toFixed(1);
    default:
      return String(value);
  }
}

/**
 * Direction is conveyed with a word and an arrow, never with colour alone,
 * so the table stays readable without colour vision.
 */
export function comparisonLabel(
  value: number | null | undefined,
  direction: "higher_is_better" | "lower_is_better" | "context",
): { tone: "good" | "bad" | "neutral"; marker: string; label: "" | "flat" | "above" | "below" } {
  if (value === null || value === undefined || direction === "context") {
    return { tone: "neutral", marker: "", label: "" };
  }
  const favourable = direction === "higher_is_better" ? value > 0 : value < 0;
  if (value === 0) return { tone: "neutral", marker: "=", label: "flat" };
  return favourable
    ? { tone: "good", marker: "▲", label: "above" }
    : { tone: "bad", marker: "▼", label: "below" };
}
