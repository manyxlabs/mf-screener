import { formatByUnit, MISSING } from "@mf/shared";
import { Badge, Card } from "@/components/ui";
import type { AttributeCell, SchemeAttributes } from "@/lib/api";
import { useI18n } from "@/lib/i18n/client";
import type { Messages } from "@/messages/en";

const FIELD_SPECS: { key: keyof Messages["fund"]["attributes"]["fields"]; unit?: string }[] = [
  { key: "riskometer" },
  { key: "exit_load_pct", unit: "percent" },
  { key: "exit_load_period_days", unit: "days" },
  { key: "lock_in_days", unit: "days" },
  { key: "min_investment", unit: "inr" },
  { key: "min_sip", unit: "inr" },
  { key: "benchmark_name" },
  { key: "fund_manager" },
  { key: "manager_tenure_years", unit: "years" },
];

function AttributeValue({ cell, unit }: { cell: AttributeCell; unit?: string }) {
  const { t, td } = useI18n();
  const reason = cell.reason_description === null ? undefined : td(cell.reason_description);
  if (cell.value === null) {
    return (
      <span className="text-ink-500" title={reason}>
        {MISSING}
      </span>
    );
  }
  const display = unit ? formatByUnit(cell.value, unit, t.units) : String(cell.value);
  return (
    <span className="flex items-center gap-1.5">
      {display}
      {cell.stale ? (
        <span title={reason ?? t.fund.attributes.staleHint}>
          <Badge tone="warn">{t.fund.attributes.stale}</Badge>
        </span>
      ) : null}
    </span>
  );
}

export function SchemeAttributesPanel({ attributes }: { attributes: SchemeAttributes | null }) {
  const { t } = useI18n();
  const words = t.fund.attributes;
  return (
    <Card title={words.title} subtitle={words.subtitle}>
      <dl className="grid gap-3 sm:grid-cols-3">
        {FIELD_SPECS.map(({ key, unit }) => {
          const cell = attributes?.fields[key];
          return (
            <div key={key} className="rounded-xl border border-ink-200 px-3 py-2">
              <dt className="text-[11px] uppercase tracking-wide text-ink-500">
                {words.fields[key]}
              </dt>
              <dd className="text-sm font-medium text-ink-900">
                {cell ? <AttributeValue cell={cell} unit={unit} /> : MISSING}
              </dd>
            </div>
          );
        })}
      </dl>
      <p className="mt-3 text-xs text-ink-500">
        {attributes?.source
          ? words.source(attributes.source, attributes.source_url)
          : words.noSource}{" "}
        {words.blankNote}
      </p>
    </Card>
  );
}
