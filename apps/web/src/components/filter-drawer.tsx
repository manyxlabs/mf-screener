"use client";

import type { Facets, MetricSpec } from "@mf/shared";
import { useId, useState } from "react";
import { useI18n } from "@/lib/i18n/client";
import type { ScreenFilters } from "@/lib/screen-query";
import type { Messages } from "@/messages/en";
import { Button, Field, PercentInput, drawerClass, inputClass } from "./ui";

const FILTERABLE_GROUPS: { title: keyof Messages["filters"]["groups"]; metrics: string[] }[] = [
  { title: "trailing", metrics: ["cagr_1y", "cagr_3y", "cagr_5y", "cagr_10y"] },
  {
    title: "rolling",
    metrics: [
      "rolling_1y_median",
      "rolling_3y_median",
      "rolling_5y_median",
      "rolling_10y_median",
      "rolling_5y_mean",
      "rolling_5y_min",
      "rolling_5y_max",
      "rolling_5y_positive_pct",
    ],
  },
  {
    title: "subCategory",
    metrics: [
      "fund_minus_category_3y",
      "fund_minus_category_5y",
      "fund_minus_category_10y",
      "fund_div_category_5y",
      "information_ratio_vs_category_5y",
    ],
  },
  {
    title: "benchmark",
    metrics: [
      "fund_minus_benchmark_5y",
      "information_ratio_vs_benchmark_5y",
      "tracking_error_5y",
      "alpha_5y",
      "alpha_tstat_5y",
      "alpha_pvalue_5y",
      "beta_5y",
    ],
  },
  {
    title: "risk",
    metrics: [
      "sharpe_5y",
      "sortino_5y",
      "volatility_5y",
      "downside_deviation_5y",
      "max_drawdown_5y",
      "calmar_5y",
    ],
  },
  {
    title: "basics",
    metrics: ["fund_age_years", "latest_aum", "latest_nav", "expense_ratio"],
  },
];

export function FilterDrawer({
  open,
  onClose,
  filters,
  onChange,
  metrics,
  facets,
}: {
  open: boolean;
  onClose: () => void;
  filters: ScreenFilters;
  onChange: (next: ScreenFilters) => void;
  metrics: Record<string, MetricSpec>;
  facets: Facets;
}) {
  const { t, td } = useI18n();
  const f = t.filters;
  const lastTickedHint = useId();
  if (!open) return null;

  // Alpha screened across the whole universe without a correction is a
  // multiple-comparisons machine: surface the caveat whenever any alpha-
  // related range is actually set as a filter, not just displayed.
  const alphaFilterActive = Object.keys(filters.ranges).some(
    (key) => key.startsWith("alpha_") && (key.endsWith("_min") || key.endsWith("_max")),
  );

  const setRange = (key: string, raw: string) => {
    const ranges = { ...filters.ranges };
    if (raw === "") delete ranges[key];
    else ranges[key] = Number(raw);
    onChange({ ...filters, ranges, page: 1 });
  };

  const toggleList = (
    field: "subCategories" | "capBands" | "styles" | "amcs" | "plans" | "options",
    value: string,
  ) => {
    const current = filters[field];
    const next = current.includes(value) ? current.filter((v) => v !== value) : [...current, value];
    onChange({ ...filters, [field]: next, page: 1 });
  };

  return (
    <aside aria-label={f.title} className={drawerClass}>
      <header className="flex items-center justify-between border-b border-ink-200 px-4 py-3">
        <h2 className="text-sm font-semibold">{f.title}</h2>
        <div className="flex gap-2">
          <Button
            variant="ghost"
            onClick={() =>
              onChange({
                ...filters,
                ranges: {},
                subCategories: [],
                capBands: [],
                styles: [],
                amcs: [],
                page: 1,
              })
            }
          >
            {f.clear}
          </Button>
          <Button onClick={onClose}>{t.common.done}</Button>
        </div>
      </header>

      <div className="flex-1 space-y-5 overflow-y-auto px-4 py-4">
        <section className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-500">
            {f.universe}
          </h3>
          <p className="text-xs text-ink-500">
            {f.universeHint} <span id={lastTickedHint}>{f.lastTicked}</span>
          </p>
          {(
            [
              ["plans", ["Direct", "Regular", "Unknown"]],
              ["options", ["Growth", "IDCW Payout", "IDCW Reinvestment", "Bonus", "Other"]],
            ] as const
          ).map(([field, values]) => (
            <div key={field} className="flex flex-wrap gap-2">
              {values.map((value) => {
                const checked = filters[field].includes(value);
                // An empty list reaches the API as no filter, which it reads as its default
                // (Direct, Growth): every box would show unticked over Direct Growth results.
                const last = checked && filters[field].length === 1;
                return (
                  <label
                    key={value}
                    className="flex items-center gap-1.5 text-sm has-disabled:cursor-not-allowed"
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={last}
                      aria-describedby={last ? lastTickedHint : undefined}
                      onChange={() => toggleList(field, value)}
                    />
                    {f.planOption[value]}
                  </label>
                );
              })}
            </div>
          ))}
          <label className="flex items-center gap-1.5 text-sm">
            <input
              type="checkbox"
              checked={filters.dedupeFamilies}
              onChange={() =>
                onChange({ ...filters, dedupeFamilies: !filters.dedupeFamilies, page: 1 })
              }
            />
            {f.onePerFund}
          </label>
          {!filters.dedupeFamilies ? (
            <p className="rounded bg-warn-50 p-2 text-xs text-warn-900">{f.onePerFundWarning}</p>
          ) : null}
        </section>

        <section className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-500">
            {f.attributes}
          </h3>
          <p className="text-xs text-ink-500">{f.attributesHint}</p>
          <label className="flex items-center gap-1.5 text-sm">
            <input
              type="checkbox"
              checked={filters.ranges.exit_load_pct_max === 0}
              onChange={() => {
                const ranges = { ...filters.ranges };
                if (ranges.exit_load_pct_max === 0) delete ranges.exit_load_pct_max;
                else ranges.exit_load_pct_max = 0;
                onChange({ ...filters, ranges, page: 1 });
              }}
            />
            {f.noExitLoad}
          </label>
          <div className="grid grid-cols-[1fr_auto] items-end gap-2">
            <Field label={f.tenure}>
              <input
                className={`${inputClass} w-24`}
                type="number"
                min={0}
                step="any"
                placeholder={f.tenurePlaceholder}
                aria-label={f.tenureLabel}
                value={filters.ranges.manager_tenure_years_min ?? ""}
                onChange={(e) => setRange("manager_tenure_years_min", e.target.value)}
              />
            </Field>
          </div>
        </section>

        <section className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-500">
            {f.styleBox}
          </h3>
          <p className="text-xs text-ink-500">{f.styleBoxHint}</p>
        </section>
        <CheckboxList
          title={f.capBand}
          values={facets.cap_bands}
          label={td}
          selected={filters.capBands}
          onToggle={(value) => toggleList("capBands", value)}
        />
        <CheckboxList
          title={f.style}
          values={facets.styles}
          label={td}
          selected={filters.styles}
          onToggle={(value) => toggleList("styles", value)}
        />
        <CheckboxList
          title={f.subCategory}
          values={facets.sub_categories}
          selected={filters.subCategories}
          onToggle={(value) => toggleList("subCategories", value)}
        />
        <CheckboxList
          title={f.amc}
          values={facets.amcs}
          selected={filters.amcs}
          onToggle={(value) => toggleList("amcs", value)}
        />

        {FILTERABLE_GROUPS.map((group) => (
          <section key={group.title} className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-500">
              {f.groups[group.title]}
            </h3>
            {group.metrics.map((name) => {
              const spec = metrics[name];
              if (!spec) return null;
              // A % suffix inside the field says what a hint used to have to.
              const isPercent = spec.unit === "percent" || spec.unit === "percentage_points";
              const hint = isPercent
                ? ""
                : spec.unit === "inr_crore"
                  ? f.inCrore
                  : spec.unit === "ratio"
                    ? f.plainNumber
                    : "";
              const fieldLabel = td(spec.plain_label || spec.label);
              return (
                <div key={name} className="grid grid-cols-[1fr_auto_auto] items-end gap-2">
                  <Field label={fieldLabel}>
                    <span className="text-[11px] text-ink-500">{hint}</span>
                  </Field>
                  {isPercent ? (
                    <PercentInput
                      className="w-24"
                      placeholder={f.min}
                      ariaLabel={f.minPercent(fieldLabel)}
                      value={filters.ranges[`${name}_min`]}
                      onChange={(decimal) => setRange(`${name}_min`, decimal)}
                    />
                  ) : (
                    <input
                      className={`${inputClass} w-24`}
                      type="number"
                      step="any"
                      placeholder={f.min}
                      aria-label={f.minOf(fieldLabel)}
                      value={filters.ranges[`${name}_min`] ?? ""}
                      onChange={(e) => setRange(`${name}_min`, e.target.value)}
                    />
                  )}
                  {isPercent ? (
                    <PercentInput
                      className="w-24"
                      placeholder={f.max}
                      ariaLabel={f.maxPercent(fieldLabel)}
                      value={filters.ranges[`${name}_max`]}
                      onChange={(decimal) => setRange(`${name}_max`, decimal)}
                    />
                  ) : (
                    <input
                      className={`${inputClass} w-24`}
                      type="number"
                      step="any"
                      placeholder={f.max}
                      aria-label={f.maxOf(fieldLabel)}
                      value={filters.ranges[`${name}_max`] ?? ""}
                      onChange={(e) => setRange(`${name}_max`, e.target.value)}
                    />
                  )}
                </div>
              );
            })}
            {group.title === "benchmark" && alphaFilterActive ? (
              <p className="rounded bg-warn-50 p-2 text-xs text-warn-900">
                {td(metrics.alpha_pvalue_5y?.caveat ?? metrics.alpha_tstat_5y?.caveat ?? "")}
              </p>
            ) : null}
          </section>
        ))}
      </div>
    </aside>
  );
}

/** `label` shows a value; the filter itself always carries the value as published. */
function CheckboxList({
  title,
  values,
  selected,
  onToggle,
  label = (value) => value,
}: {
  title: string;
  values: string[];
  selected: string[];
  onToggle: (value: string) => void;
  label?: (value: string) => string;
}) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const q = query.toLowerCase();
  const filtered = values.filter(
    (v) => v.toLowerCase().includes(q) || label(v).toLowerCase().includes(q),
  );
  return (
    <section className="space-y-2">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-500">{title}</h3>
      <input
        className={`${inputClass} w-full`}
        placeholder={t.filters.searchIn(title)}
        aria-label={t.filters.searchIn(title)}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <div className="max-h-44 space-y-1 overflow-y-auto rounded border border-ink-200 p-2">
        {filtered.map((value) => (
          <label key={value} className="flex items-center gap-1.5 text-sm">
            <input
              type="checkbox"
              checked={selected.includes(value)}
              onChange={() => onToggle(value)}
            />
            {label(value)}
          </label>
        ))}
        {filtered.length === 0 ? (
          <p className="text-xs text-ink-500">{t.filters.noMatches}</p>
        ) : null}
      </div>
    </section>
  );
}
