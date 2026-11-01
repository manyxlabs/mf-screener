import { formatByUnit, MISSING } from "@mf/shared";
import { Badge, Card } from "@/components/ui";
import type { AttributeCell, SchemeAttributes } from "@/lib/api";

const FIELD_SPECS: { key: string; label: string; unit?: string }[] = [
  { key: "riskometer", label: "Riskometer" },
  { key: "exit_load_pct", label: "Exit load", unit: "percent" },
  { key: "exit_load_period_days", label: "Exit load period", unit: "days" },
  { key: "lock_in_days", label: "Lock-in", unit: "days" },
  { key: "min_investment", label: "Minimum investment", unit: "inr" },
  { key: "min_sip", label: "Minimum SIP", unit: "inr" },
  { key: "benchmark_name", label: "Benchmark (per SID)" },
  { key: "fund_manager", label: "Fund manager" },
  { key: "manager_tenure_years", label: "Manager tenure", unit: "years" },
];

function AttributeValue({ cell, unit }: { cell: AttributeCell; unit?: string }) {
  if (cell.value === null) {
    return (
      <span className="text-ink-500" title={cell.reason_description ?? undefined}>
        {MISSING}
      </span>
    );
  }
  const display = unit ? formatByUnit(cell.value, unit) : String(cell.value);
  return (
    <span className="flex items-center gap-1.5">
      {display}
      {cell.stale ? (
        <span title={cell.reason_description ?? "This value is stale."}>
          <Badge tone="warn">stale</Badge>
        </span>
      ) : null}
    </span>
  );
}

export function SchemeAttributesPanel({ attributes }: { attributes: SchemeAttributes | null }) {
  return (
    <Card
      title="Scheme attributes"
      subtitle="Riskometer, exit load, lock-in, minimums, SID benchmark and fund manager. Third-party facts, not computed from NAV - never used in a return, risk figure or ranking anywhere on this site."
    >
      <dl className="grid gap-3 sm:grid-cols-3">
        {FIELD_SPECS.map(({ key, label, unit }) => {
          const cell = attributes?.fields[key];
          return (
            <div key={key} className="rounded-md border border-ink-200 px-3 py-2">
              <dt className="text-[11px] uppercase tracking-wide text-ink-500">{label}</dt>
              <dd className="text-sm font-medium text-ink-900">
                {cell ? <AttributeValue cell={cell} unit={unit} /> : MISSING}
              </dd>
            </div>
          );
        })}
      </dl>
      <p className="mt-3 text-xs text-ink-500">
        {attributes?.source
          ? `Source: ${attributes.source}${attributes.source_url ? ` (${attributes.source_url})` : ""}.`
          : "No enrichment source has published attributes for this scheme yet."}{" "}
        A blank cell names its own reason on hover rather than defaulting to zero or &ldquo;no
        load&rdquo;.
      </p>
    </Card>
  );
}
