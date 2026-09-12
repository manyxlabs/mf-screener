"use client";

import type { ColumnsResponse, MetricSpec, Scheme } from "@mf/shared";
import { formatByUnit } from "@mf/shared";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Fragment, useEffect, useMemo, useState } from "react";
import { Button, Card, inputClass } from "@/components/ui";
import { getScheme, getSchemeBehaviour, getSchemeMetrics, getSchemes } from "@/lib/api";
import { DERIVED_SPECS, derive, extremes, type Entry } from "./compare-rows";

const MAX_FUNDS = 5;

const SECTIONS: { title: string; keys: string[] }[] = [
  { title: "Trailing returns", keys: ["cagr_1y", "cagr_3y", "cagr_5y", "cagr_10y"] },
  {
    title: "Rolling returns",
    keys: [
      "rolling_1y_median",
      "rolling_3y_median",
      "rolling_5y_median",
      "rolling_10y_median",
      "rolling_5y_min",
      "rolling_5y_positive_pct",
      "rolling_5y_std",
    ],
  },
  {
    title: "Versus sub-category",
    keys: [
      "category_return_5y",
      "fund_minus_category_3y",
      "fund_minus_category_5y",
      "fund_minus_category_10y",
      "fund_div_category_5y",
      "information_ratio_vs_category_5y",
    ],
  },
  {
    title: "Cost",
    keys: ["expense_ratio"],
  },
  {
    title: "Downside and consistency",
    keys: [
      "worst_fall",
      "worst_fall_recovery_days",
      "up_capture",
      "down_capture",
      "calendar_years_beaten_pct",
    ],
  },
  {
    title: "Risk",
    keys: [
      "sharpe_5y",
      "sortino_5y",
      "volatility_5y",
      "max_drawdown_5y",
      "calmar_5y",
      "beta_5y",
      "alpha_5y",
      "tracking_error_5y",
    ],
  },
];

export function CompareClient({ columnsMeta }: { columnsMeta: ColumnsResponse }) {
  const searchParams = useSearchParams();
  const specs = useMemo(
    () =>
      ({
        ...Object.fromEntries(columnsMeta.metrics.map((m) => [m.name, m])),
        ...DERIVED_SPECS,
      }) as Record<string, MetricSpec>,
    [columnsMeta.metrics],
  );

  const [codes, setCodes] = useState<string[]>(() =>
    (searchParams.get("codes") ?? "").split(",").filter(Boolean).slice(0, MAX_FUNDS),
  );
  const [entries, setEntries] = useState<Entry[]>([]);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Scheme[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all(
      codes.map(async (code) => ({
        scheme: (await getScheme(code)).scheme as Scheme,
        metrics: await getSchemeMetrics(code),
        behaviour: await getSchemeBehaviour(code),
      })),
    )
      .then((loaded) => !cancelled && setEntries(loaded))
      .catch((err: Error) => !cancelled && setError(err.message));
    return () => {
      cancelled = true;
    };
  }, [codes]);

  useEffect(() => {
    if (query.trim().length < 2) {
      setResults([]);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      getSchemes(`q=${encodeURIComponent(query.trim())}&limit=10`)
        .then((response) => !cancelled && setResults(response.items))
        .catch(() => !cancelled && setResults([]));
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query]);

  const records = entries.map(derive);
  const subCategories = new Set(entries.map((e) => e.scheme.clean_sub_category ?? ""));
  const plans = new Set(entries.map((e) => e.scheme.clean_plan ?? ""));
  const options = new Set(entries.map((e) => e.scheme.clean_option ?? ""));

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-lg font-semibold tracking-tight">Compare funds</h1>
        <p className="mt-1 text-sm text-ink-500">
          Up to {MAX_FUNDS} funds side by side. In each row the best value is marked ▲ and the worst
          ▼, judged by that metric&apos;s own better direction. Rows where neither end is better,
          such as beta, are left unmarked.
        </p>
      </header>

      <Card title="Add a fund">
        <input
          className={`${inputClass} w-full max-w-lg`}
          placeholder="Search by fund name, AMC or scheme code"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search funds to compare"
        />
        {results.length ? (
          <ul className="mt-2 max-w-lg space-y-1">
            {results.map((scheme) => (
              <li key={scheme.scheme_code}>
                <button
                  className="w-full rounded px-2 py-1 text-left text-sm hover:bg-ink-100 disabled:opacity-40"
                  disabled={codes.includes(scheme.scheme_code) || codes.length >= MAX_FUNDS}
                  onClick={() => {
                    setCodes((c) => [...c, scheme.scheme_code]);
                    setQuery("");
                  }}
                >
                  {scheme.scheme_name}
                  <span className="ml-2 text-xs text-ink-500">{scheme.clean_sub_category}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </Card>

      {error ? <p className="text-sm text-bad-700">{error}</p> : null}

      {entries.length > 1 && (subCategories.size > 1 || plans.size > 1 || options.size > 1) ? (
        <div className="rounded-md border border-warn-300 bg-warn-50 p-3 text-sm text-warn-900">
          <strong>This is not an apples-to-apples comparison.</strong>{" "}
          {subCategories.size > 1
            ? `These funds span ${subCategories.size} sub-categories (${[...subCategories].join(", ")}). `
            : ""}
          {plans.size > 1
            ? `They mix plans (${[...plans].join(", ")}), and the same portfolio has a different NAV in each. `
            : ""}
          {options.size > 1
            ? `They mix options (${[...options].join(", ")}); an IDCW option pays out of NAV, so its return series is not comparable to a Growth one.`
            : ""}
        </div>
      ) : null}

      {entries.length === 0 ? (
        <p className="text-sm text-ink-500">
          Nothing selected yet. Pick funds above, or tick rows in the{" "}
          <Link href="/screener" className="text-accent-600 hover:underline">
            screener
          </Link>
          .
        </p>
      ) : (
        <div
          // `relative` makes this the containing block for the sticky cells; without it their
          // layout overflow escapes onto the root document and the whole page scrolls sideways.
          className="relative overflow-x-auto rounded-lg border border-ink-200 bg-surface"
        >
          <table className="min-w-full text-sm">
            <thead>
              <tr className="bg-ink-50">
                <th className="sticky left-0 z-10 bg-ink-50 px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-ink-500">
                  Metric
                </th>
                {entries.map((entry) => (
                  <th key={entry.scheme.scheme_code} className="px-3 py-2 text-left align-top">
                    <Link
                      href={`/fund/${entry.scheme.scheme_code}`}
                      className="text-accent-600 hover:underline"
                    >
                      {entry.scheme.scheme_name}
                    </Link>
                    <div className="mt-0.5 text-xs font-normal text-ink-500">
                      {entry.scheme.clean_sub_category} · {entry.scheme.clean_plan} ·{" "}
                      {entry.scheme.clean_option}
                    </div>
                    <Button
                      variant="ghost"
                      className="mt-1 px-1 py-0 text-xs"
                      onClick={() =>
                        setCodes((c) => c.filter((code) => code !== entry.scheme.scheme_code))
                      }
                    >
                      Remove
                    </Button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {SECTIONS.map((section) => (
                <Fragment key={section.title}>
                  <tr className="bg-ink-50">
                    <td
                      colSpan={entries.length + 1}
                      className="px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-ink-700"
                    >
                      {section.title}
                    </td>
                  </tr>
                  {section.keys.map((key) => {
                    const values = records.map((record) =>
                      typeof record[key] === "number" ? (record[key] as number) : null,
                    );
                    const { best, worst } = extremes(values, specs[key]?.direction ?? "context");
                    return (
                      <tr key={key} className="border-t border-ink-100">
                        <td className="sticky left-0 z-10 bg-surface px-3 py-1.5">
                          {specs[key]?.label ?? key}
                        </td>
                        {entries.map((entry, index) => {
                          const raw = records[index]![key];
                          const value = values[index];
                          const reason = entry.metrics.missing_reasons[key];
                          // Colour is never the only carrier: a marker and a screen-reader
                          // label say which end this is, per the rule in @mf/shared/format.
                          const rank =
                            value === null || value === best
                              ? value === null
                                ? null
                                : ("best" as const)
                              : value === worst
                                ? ("worst" as const)
                                : null;
                          const tone =
                            rank === "best"
                              ? "font-semibold text-good-700"
                              : rank === "worst"
                                ? "text-bad-700"
                                : "";
                          return (
                            <td key={entry.scheme.scheme_code} className="px-3 py-1.5">
                              {raw === null || raw === undefined ? (
                                <span
                                  className="cursor-help text-ink-500 underline decoration-dotted"
                                  title={
                                    entry.metrics.missing_reason_descriptions[reason ?? ""] ??
                                    reason ??
                                    "Not available"
                                  }
                                >
                                  -
                                </span>
                              ) : (
                                <span className={`numeric ${tone}`}>
                                  {rank ? (
                                    <span aria-hidden="true">{rank === "best" ? "▲ " : "▼ "}</span>
                                  ) : null}
                                  {formatByUnit(raw, specs[key]?.unit ?? "ratio")}
                                  {rank ? (
                                    <span className="sr-only"> ({rank} of those compared)</span>
                                  ) : null}
                                </span>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
