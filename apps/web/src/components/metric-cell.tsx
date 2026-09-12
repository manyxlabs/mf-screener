"use client";

import { comparisonLabel, formatByUnit, MISSING, type MetricSpec } from "@mf/shared";
import { InfoTooltip } from "./tooltip";

export function MetricHeader({ spec, name }: { spec?: MetricSpec; name: string }) {
  if (!spec) return <span>{name}</span>;
  // Two thirds of the catalog is higher-is-better, so as a sentence of its own this
  // said nothing on most columns and buried the cases where it matters. It rides the
  // metadata line instead, where "lower" and "neither" stand out against the default.
  const desirable =
    spec.direction === "higher_is_better"
      ? "Better: higher"
      : spec.direction === "lower_is_better"
        ? "Better: lower"
        : "Neither direction is better";
  return (
    <InfoTooltip label={<span className="underline decoration-dotted">{spec.label}</span>}>
      <span className="block font-semibold text-ink-900">{spec.label}</span>
      <span className="mt-1 block">{spec.definition}</span>
      <span className="mt-1.5 block text-ink-500">
        Frequency: {spec.frequency} · Period: {spec.period} · {desirable}
      </span>
      <span className="mt-1.5 block border-t border-ink-200 pt-1.5 text-ink-500">
        Caveat: {spec.caveat}
      </span>
    </InfoTooltip>
  );
}

/** A dash is never bare: clicking it says exactly why the value is unavailable. */
export function MissingValue({ reason, description }: { reason?: string; description?: string }) {
  if (!reason) return <span className="text-ink-300">{MISSING}</span>;
  return (
    <InfoTooltip
      align="right"
      label={<span className="text-ink-500 underline decoration-dotted">{MISSING}</span>}
    >
      <span className="block font-semibold text-ink-900">Not available</span>
      <span className="mt-1 block">{description ?? reason}</span>
      <span className="mt-1.5 block font-mono text-[11px] text-ink-500">{reason}</span>
    </InfoTooltip>
  );
}

export function MetricValue({
  value,
  spec,
  reason,
  reasonDescription,
}: {
  value: unknown;
  spec?: MetricSpec;
  reason?: string;
  reasonDescription?: string;
}) {
  if (value === null || value === undefined) {
    return <MissingValue reason={reason} description={reasonDescription} />;
  }
  const unit = spec?.unit ?? "text";
  const text = formatByUnit(value, unit);
  if (
    typeof value === "number" &&
    spec &&
    (unit === "percentage_points" || spec.name.startsWith("fund_minus_"))
  ) {
    const { tone, marker, label } = comparisonLabel(value, spec.direction);
    const toneClass =
      tone === "good" ? "text-good-700" : tone === "bad" ? "text-bad-700" : "text-ink-700";
    return (
      <span className={`numeric ${toneClass}`}>
        <span aria-hidden="true">{marker} </span>
        {text}
        {label ? <span className="sr-only"> ({label} peers)</span> : null}
      </span>
    );
  }
  return <span className="numeric">{text}</span>;
}
