"use client";

import type { ColumnsResponse, MetricSpec, Scheme } from "@mf/shared";
import { formatByUnit } from "@mf/shared";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Fragment, useEffect, useMemo, useState } from "react";
import { FundPicker } from "@/components/fund-picker";
import { getScheme, getSchemeBehaviour, getSchemeMetrics } from "@/lib/api";
import { DERIVED_SPECS, derive, extremes, MAX_FUNDS, type Entry } from "./compare-rows";

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

  // The URL is the comparison, so it can be shared or bookmarked as it stands.
  useEffect(() => {
    window.history.replaceState(
      null,
      "",
      codes.length ? `?codes=${codes.join(",")}` : window.location.pathname,
    );
  }, [codes]);
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

  const records = entries.map(derive);
  const subCategories = new Set(entries.map((e) => e.scheme.clean_sub_category ?? ""));
  const plans = new Set(entries.map((e) => e.scheme.clean_plan ?? ""));
  const options = new Set(entries.map((e) => e.scheme.clean_option ?? ""));

  return (
    <div className="space-y-6">
      <FundPicker
        label="Search funds to compare"
        chosen={codes}
        max={MAX_FUNDS}
        onPick={(scheme) => setCodes((c) => [...c, scheme.scheme_code])}
      />

      {error ? <p className="text-sm text-bad-700">{error}</p> : null}

      {entries.length > 1 && (subCategories.size > 1 || plans.size > 1 || options.size > 1) ? (
        <div className="rounded-xl border border-warn-300 bg-warn-50 p-4 text-sm text-warn-900">
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
        <div className="rounded-2xl border border-dashed border-ink-300 px-6 py-14 text-center">
          <p className="text-base font-semibold text-ink-900">Nothing to compare yet</p>
          <p className="mx-auto mt-2 max-w-md text-sm text-ink-500">
            Add funds with the search above, or tick up to five rows in the screener and press
            Compare. Funds of the same type and plan compare most fairly.
          </p>
          <Link
            href="/screener"
            className="mt-5 inline-block rounded-lg bg-accent-500 px-4 py-2 text-sm font-medium text-on-accent shadow-sm hover:bg-accent-600"
          >
            Find funds in the screener
          </Link>
        </div>
      ) : (
        <div
          // `relative` makes this the containing block for the sticky cells; without it their
          // layout overflow escapes onto the root document and the whole page scrolls sideways.
          className="scroll-x relative overflow-x-auto rounded-xl border border-ink-200 bg-surface shadow-card"
        >
          <table className="min-w-full text-sm">
            <thead>
              <tr>
                <th className="sticky left-0 z-10 w-40 min-w-40 bg-surface sm:w-64 sm:min-w-56 px-4 py-3 text-left align-bottom text-xs font-medium text-ink-500">
                  Metric
                </th>
                {entries.map((entry) => (
                  <th
                    key={entry.scheme.scheme_code}
                    className="min-w-52 px-4 py-3 text-left align-top font-normal"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <Link
                        href={`/fund/${entry.scheme.scheme_code}`}
                        className="font-semibold text-ink-900 hover:text-accent-600 hover:underline"
                      >
                        {entry.scheme.scheme_name}
                      </Link>
                      <button
                        type="button"
                        aria-label={`Remove ${entry.scheme.scheme_name}`}
                        title="Remove"
                        className="-mt-0.5 shrink-0 rounded-full px-1.5 text-base leading-6 text-ink-500 hover:bg-ink-100 hover:text-ink-900"
                        onClick={() =>
                          setCodes((c) => c.filter((code) => code !== entry.scheme.scheme_code))
                        }
                      >
                        ×
                      </button>
                    </div>
                    <div className="mt-1 text-xs text-ink-500">
                      {entry.scheme.clean_sub_category} · {entry.scheme.clean_plan} ·{" "}
                      {entry.scheme.clean_option}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {SECTIONS.map((section) => (
                <Fragment key={section.title}>
                  <tr>
                    <th
                      scope="colgroup"
                      colSpan={entries.length + 1}
                      className="border-t border-ink-200 bg-ink-50 px-4 py-2 text-left text-xs font-semibold text-ink-700"
                    >
                      {section.title}
                    </th>
                  </tr>
                  {section.keys.map((key) => {
                    const values = records.map((record) =>
                      typeof record[key] === "number" ? (record[key] as number) : null,
                    );
                    const { best, worst } = extremes(values, specs[key]?.direction ?? "context");
                    const plain = specs[key]?.plain_label;
                    const label = specs[key]?.label ?? key;
                    return (
                      <tr
                        key={key}
                        className="border-t border-ink-100 bg-surface hover:bg-accent-50"
                      >
                        <th
                          scope="row"
                          className="sticky left-0 z-10 bg-inherit px-4 py-2.5 text-left font-normal"
                        >
                          <div className="text-ink-900">{plain || label}</div>
                          {plain && plain !== label ? (
                            <div className="text-[11px] text-ink-500">{label}</div>
                          ) : null}
                        </th>
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
                            <td key={entry.scheme.scheme_code} className="px-4 py-2.5">
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
