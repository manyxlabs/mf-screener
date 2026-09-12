import { formatByUnit, MISSING } from "@mf/shared";
import { z } from "zod";
import { Badge, Card } from "@/components/ui";
import { API_BASE, ApiError } from "@/lib/api";

// T3.2: riskometer, exit load, lock-in, minimums, SID benchmark and fund manager -
// third-party per docs/data-policy.md, so this is its own fetch and its own panel
// rather than folded into the metrics-backed sections above, which are computed from
// AMFI NAV alone.

const attributeCellSchema = z.object({
  value: z.union([z.string(), z.number(), z.boolean()]).nullable(),
  as_of: z.string().nullable(),
  stale: z.boolean(),
  reason: z.string().nullable(),
  reason_description: z.string().nullable(),
});

const schemeAttributesSchema = z.object({
  scheme_code: z.string(),
  fields: z.record(z.string(), attributeCellSchema),
  source: z.string().nullable(),
  source_url: z.string().nullable(),
  disclaimer: z.string(),
});

export type SchemeAttributesResponse = z.infer<typeof schemeAttributesSchema>;
type AttributeCell = z.infer<typeof attributeCellSchema>;

export async function getSchemeAttributes(code: string): Promise<SchemeAttributesResponse | null> {
  const response = await fetch(`${API_BASE}/schemes/${code}/attributes`, {
    headers: { Accept: "application/json" },
    next: { revalidate: 0 },
  });
  if (!response.ok) {
    if (response.status === 404) return null;
    throw new ApiError(response.statusText, response.status);
  }
  return schemeAttributesSchema.parse(await response.json());
}

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

export function SchemeAttributesPanel({
  attributes,
}: {
  attributes: SchemeAttributesResponse | null;
}) {
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
