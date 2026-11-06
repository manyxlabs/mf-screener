"use client";

import type { Facets, MetricSpec } from "@mf/shared";
import { useState } from "react";
import type { ScreenFilters } from "@/lib/screen-query";
import { Button, Field, PercentInput, drawerClass, inputClass } from "./ui";

const FILTERABLE_GROUPS: { title: string; metrics: string[] }[] = [
  { title: "Trailing returns", metrics: ["cagr_1y", "cagr_3y", "cagr_5y", "cagr_10y"] },
  {
    title: "Rolling returns",
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
    title: "Versus sub-category",
    metrics: [
      "fund_minus_category_3y",
      "fund_minus_category_5y",
      "fund_minus_category_10y",
      "fund_div_category_5y",
      "information_ratio_vs_category_5y",
    ],
  },
  {
    title: "Versus benchmark",
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
    title: "Risk",
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
    title: "Fund basics",
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
    <aside
      aria-label="Filters"
      className={drawerClass}
    >
      <header className="flex items-center justify-between border-b border-ink-200 px-4 py-3">
        <h2 className="text-sm font-semibold">Filters</h2>
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
            Clear
          </Button>
          <Button onClick={onClose}>Done</Button>
        </div>
      </header>

      <div className="flex-1 space-y-5 overflow-y-auto px-4 py-4">
        <section className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-500">Universe</h3>
          <p className="text-xs text-ink-500">
            Direct and Growth only by default. Direct and Regular plans of one fund have different
            NAVs, and IDCW options pay out of NAV, so mixing them corrupts every comparison.
          </p>
          <div className="flex flex-wrap gap-2">
            {["Direct", "Regular", "Unknown"].map((plan) => (
              <label key={plan} className="flex items-center gap-1.5 text-sm">
                <input
                  type="checkbox"
                  checked={filters.plans.includes(plan)}
                  onChange={() => toggleList("plans", plan)}
                />
                {plan}
              </label>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            {["Growth", "IDCW Payout", "IDCW Reinvestment", "Bonus", "Other"].map((option) => (
              <label key={option} className="flex items-center gap-1.5 text-sm">
                <input
                  type="checkbox"
                  checked={filters.options.includes(option)}
                  onChange={() => toggleList("options", option)}
                />
                {option}
              </label>
            ))}
          </div>
          <label className="flex items-center gap-1.5 text-sm">
            <input
              type="checkbox"
              checked={filters.dedupeFamilies}
              onChange={() =>
                onChange({ ...filters, dedupeFamilies: !filters.dedupeFamilies, page: 1 })
              }
            />
            One row per fund
          </label>
          {!filters.dedupeFamilies ? (
            <p className="rounded bg-warn-50 p-2 text-xs text-warn-900">
              Direct and Regular, Growth and IDCW are separate scheme codes for one fund. Showing
              them all inflates every count and lets one fund occupy several places in a ranking.
            </p>
          ) : null}
        </section>

        <section className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-500">
            Shortlist attributes
          </h3>
          <p className="text-xs text-ink-500">
            Riskometer, exit load, lock-in, minimums, SID benchmark and fund manager (T3.2) are
            third-party facts, not computed from NAV. A fund the source has not published these for
            cannot satisfy either filter below - it is left out, not assumed to qualify.
          </p>
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
            No exit load
          </label>
          <div className="grid grid-cols-[1fr_auto] items-end gap-2">
            <Field label="Manager tenure at least (years)">
              <input
                className={`${inputClass} w-24`}
                type="number"
                min={0}
                step="any"
                placeholder="e.g. 3"
                aria-label="Manager tenure minimum, in years"
                value={filters.ranges.manager_tenure_years_min ?? ""}
                onChange={(e) => setRange("manager_tenure_years_min", e.target.value)}
              />
            </Field>
          </div>
        </section>

        <section className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-500">Style box</h3>
          <p className="text-xs text-ink-500">
            The mandate each scheme declares, read from its SEBI sub-category and its own name. A
            holdings-based style box needs the price-to-book of the portfolio, which AMFI does not
            publish, so this is what the fund says it does, not what it currently owns.
          </p>
        </section>
        <CheckboxList
          title="Cap band"
          values={facets.cap_bands}
          selected={filters.capBands}
          onToggle={(value) => toggleList("capBands", value)}
        />
        <CheckboxList
          title="Style"
          values={facets.styles}
          selected={filters.styles}
          onToggle={(value) => toggleList("styles", value)}
        />
        <CheckboxList
          title="Sub-category"
          values={facets.sub_categories}
          selected={filters.subCategories}
          onToggle={(value) => toggleList("subCategories", value)}
        />
        <CheckboxList
          title="AMC"
          values={facets.amcs}
          selected={filters.amcs}
          onToggle={(value) => toggleList("amcs", value)}
        />

        {FILTERABLE_GROUPS.map((group) => (
          <section key={group.title} className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-500">
              {group.title}
            </h3>
            {group.metrics.map((name) => {
              const spec = metrics[name];
              if (!spec) return null;
              // A % suffix inside the field says what a hint used to have to.
              const isPercent = spec.unit === "percent" || spec.unit === "percentage_points";
              const hint = isPercent
                ? ""
                : spec.unit === "inr_crore"
                  ? "in crore"
                  : spec.unit === "ratio"
                    ? "a plain number"
                    : "";
              const fieldLabel = spec.plain_label || spec.label;
              return (
                <div key={name} className="grid grid-cols-[1fr_auto_auto] items-end gap-2">
                  <Field label={fieldLabel}>
                    <span className="text-[11px] text-ink-500">{hint}</span>
                  </Field>
                  {isPercent ? (
                    <PercentInput
                      className="w-24"
                      placeholder="min"
                      ariaLabel={`${fieldLabel} minimum, in percent`}
                      value={filters.ranges[`${name}_min`]}
                      onChange={(decimal) => setRange(`${name}_min`, decimal)}
                    />
                  ) : (
                    <input
                      className={`${inputClass} w-24`}
                      type="number"
                      step="any"
                      placeholder="min"
                      aria-label={`${fieldLabel} minimum`}
                      value={filters.ranges[`${name}_min`] ?? ""}
                      onChange={(e) => setRange(`${name}_min`, e.target.value)}
                    />
                  )}
                  {isPercent ? (
                    <PercentInput
                      className="w-24"
                      placeholder="max"
                      ariaLabel={`${fieldLabel} maximum, in percent`}
                      value={filters.ranges[`${name}_max`]}
                      onChange={(decimal) => setRange(`${name}_max`, decimal)}
                    />
                  ) : (
                    <input
                      className={`${inputClass} w-24`}
                      type="number"
                      step="any"
                      placeholder="max"
                      aria-label={`${fieldLabel} maximum`}
                      value={filters.ranges[`${name}_max`] ?? ""}
                      onChange={(e) => setRange(`${name}_max`, e.target.value)}
                    />
                  )}
                </div>
              );
            })}
            {group.title === "Versus benchmark" && alphaFilterActive ? (
              <p className="rounded bg-warn-50 p-2 text-xs text-warn-900">
                {metrics.alpha_pvalue_5y?.caveat ?? metrics.alpha_tstat_5y?.caveat}
              </p>
            ) : null}
          </section>
        ))}
      </div>
    </aside>
  );
}

function CheckboxList({
  title,
  values,
  selected,
  onToggle,
}: {
  title: string;
  values: string[];
  selected: string[];
  onToggle: (value: string) => void;
}) {
  const [query, setQuery] = useState("");
  const filtered = values.filter((v) => v.toLowerCase().includes(query.toLowerCase()));
  return (
    <section className="space-y-2">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-500">{title}</h3>
      <input
        className={`${inputClass} w-full`}
        placeholder={`Search ${title.toLowerCase()}`}
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
            {value}
          </label>
        ))}
        {filtered.length === 0 ? <p className="text-xs text-ink-500">No matches.</p> : null}
      </div>
    </section>
  );
}
