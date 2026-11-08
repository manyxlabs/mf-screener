"use client";

import {
  formatByUnit,
  formatCrore,
  formatPercent,
  formatYears,
  type Benchmark,
  type MetricSpec,
  type SchemeDetail,
} from "@mf/shared";
import { useEffect, useState } from "react";
import { Breadcrumbs } from "@/components/json-ld";
import Link from "@/components/link";
import { MetricValue } from "@/components/metric-cell";
import { Badge, Button, Card, Stat } from "@/components/ui";
import {
  ApiError,
  getColumns,
  getComparison,
  getSchemeAttributes,
  getSchemeBehaviour,
  getSchemeExposure,
  getSchemeMetrics,
  getSchemeNav,
  getSchemeRollingExposure,
} from "@/lib/api";
import { useI18n } from "@/lib/i18n/client";
import { SITE_NAME } from "@/lib/site";
import type { Messages } from "@/messages/en";
import {
  CalendarYears,
  CostPanel,
  DrawdownHistory,
  ExposurePanel,
  StyleDriftPanel,
} from "./behaviour-panels";
import { FundCharts } from "./fund-charts";
import { PeerComparison } from "./peer-comparison";
import { rollingSummary, type RollingSpread } from "./rolling-summary";
import { SchemeAttributesPanel } from "./scheme-attributes-panel";
import { Tearsheet } from "./tearsheet";

const HORIZONS = [3, 5, 10] as const;

// Each row spans the 3Y, 5Y and 10Y columns of the metric named by its key.
const RISK_ROWS: (keyof Messages["fund"]["risk"]["rows"])[] = [
  "sharpe",
  "sortino",
  "volatility",
  "downside_deviation",
  "max_drawdown",
  "calmar",
  "tracking_error",
  "alpha",
  "beta",
  "r_squared",
  "information_ratio_vs_category",
  "information_ratio_vs_benchmark",
];

const SECTIONS = ["returns", "charts", "rolling", "risk", "behaviour", "peers", "missing"] as const;

const ROLLING_STATS = ["mean", "median", "min", "max", "std", "positive_pct"] as const;

/**
 * The plain label for a metric, with its horizon dropped: these rows span the 3Y, 5Y
 * and 10Y columns at once, so "Return earned per unit of downside (5Y)" would name the
 * wrong horizon in two cells out of three.
 */
function plainRowLabel(spec: MetricSpec | undefined): string | null {
  const plain = spec?.plain_label;
  return plain ? plain.replace(/\s*\(\d+Y\)$/, "") : null;
}

/**
 * The title in the reader's language, which the server could only render in English.
 * Set for English too, so switching back in place restores it.
 */
function useFundTitle(name: string) {
  const { t } = useI18n();
  const title = `${t.fund.metaTitle(name)} | ${SITE_NAME}`;
  useEffect(() => {
    document.title = title;
  }, [title]);
}

/** The trail without a category page falls back to the screener, named in the reader's language. */
export function FundBreadcrumbs({
  parent,
  name,
  path,
}: {
  parent: [name: string, path: string] | null;
  name: string;
  path: string;
}) {
  const { t } = useI18n();
  return <Breadcrumbs trail={[parent ?? [t.nav.screener, "/screener/"], [name, path]]} />;
}

/** A fund the source lists but nothing can be computed for. Not an error page. */
export function NoMetrics({ scheme, reason }: { scheme: SchemeDetail["scheme"]; reason: string }) {
  const { t, td } = useI18n();
  useFundTitle(scheme.scheme_name);
  const words = t.fund.noMetrics;
  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">{scheme.scheme_name}</h1>
        <p className="mt-1 text-sm text-ink-500">
          {words.identity(scheme.amc ?? "", scheme.clean_sub_category ?? "", scheme.scheme_code)}
        </p>
      </header>
      <Card title={words.title}>
        <p className="text-sm text-ink-700">{td(reason)}</p>
        <dl className="mt-4 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
          {[
            [words.status, scheme.is_active ? t.fund.active : t.fund.inactive],
            [
              words.navDates,
              words.navRange(scheme.first_nav_date ?? "-", scheme.last_nav_date ?? "-"),
            ],
            [words.planOption, `${scheme.clean_plan} / ${scheme.clean_option}`],
            [words.category, scheme.clean_category ?? "-"],
          ].map(([label, value]) => (
            <div key={label} className="flex justify-between gap-4 border-b border-ink-100 py-1">
              <dt className="text-ink-500">{label}</dt>
              <dd className="text-right text-ink-900">{value}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-4 text-xs text-ink-500">
          {words.kept}{" "}
          <Link href="/methodology" className="text-accent-600 hover:underline">
            {t.nav.methodology}
          </Link>
        </p>
      </Card>
    </div>
  );
}

function CategoryChangeNote({ history }: { history: SchemeDetail["category_history"] }) {
  const { t } = useI18n();
  const words = t.fund.categoryChange;
  // One entry is the normal case: observed once, never seen to change.
  const from = history[0];
  const to = history[history.length - 1];
  if (!from || !to || from === to) return null;
  return (
    <p className="rounded border border-warn-300 bg-warn-50 px-3 py-2 text-xs text-warn-900">
      <span aria-hidden="true">⚠ </span>
      {words.onDate}
      <span className="font-medium">{to.valid_from}</span>
      {words.from}
      <span className="font-medium">{from.clean_sub_category ?? from.clean_category}</span>
      {words.to}
      <span className="font-medium">{to.clean_sub_category ?? to.clean_category}</span>
      {words.after}
    </p>
  );
}

/**
 * Shown wherever a benchmark-relative number would otherwise sit. Every such metric is
 * already null when the currencies differ, but a column of dashes reads as "no data
 * yet" and invites someone to go and load the very series that must not be used. This
 * says which series is mapped, that it is in the wrong currency, and that the gap is
 * deliberate.
 */
function BenchmarkCurrencyNote({
  benchmark,
  computedAgainst,
}: {
  benchmark: Benchmark | null;
  computedAgainst: string | null;
}) {
  const { t } = useI18n();
  const wrapper = "mb-3 rounded border border-bad-300 bg-bad-50 px-3 py-2 text-xs text-bad-900";
  if (benchmark && !benchmark.comparable_with_inr_funds) {
    return (
      <p className={wrapper}>
        <span aria-hidden="true">⚠ </span>
        {t.fund.currencyWithheld.before}
        <span className="font-medium">{benchmark.benchmark_id}</span>
        {t.fund.currencyWithheld.after(benchmark.currency, benchmark.fund_currency)}
      </p>
    );
  }
  // The mapping is live but the metrics are a stored snapshot. Between a re-map and the
  // next `make metrics` the two disagree, and the numbers below would be attributed to
  // an index they were never computed against - including one in another currency.
  if (computedAgainst && benchmark && computedAgainst !== benchmark.benchmark_id) {
    return (
      <p className={wrapper}>
        <span aria-hidden="true">⚠ </span>
        {t.fund.staleBenchmark.before}
        <span className="font-medium">{computedAgainst}</span>
        {t.fund.staleBenchmark.remapped}
        <span className="font-medium">{benchmark.benchmark_id}</span>
        {t.fund.staleBenchmark.run}
        <code className="rounded bg-bad-100 px-1">make metrics</code>
        {t.fund.staleBenchmark.after}
      </p>
    );
  }
  return null;
}

function value(record: Record<string, unknown>, key: string): number | null {
  const raw = record[key];
  return typeof raw === "number" ? raw : null;
}

function Cell({
  record,
  keyName,
  metrics,
}: {
  record: Record<string, unknown>;
  keyName: string;
  metrics: Record<string, MetricSpec>;
}) {
  const { t, td } = useI18n();
  const raw = value(record, keyName);
  const reasons = (record["missing_reasons"] ?? {}) as Record<string, string | undefined>;
  const descriptions = (record["missing_reason_descriptions"] ?? {}) as Record<
    string,
    string | undefined
  >;
  if (raw === null) {
    const reason = reasons[keyName];
    return (
      <span
        className="cursor-help text-ink-500 underline decoration-dotted"
        title={td((reason ? descriptions[reason] : undefined) ?? reason ?? t.metric.notAvailable)}
      >
        -
      </span>
    );
  }
  return (
    <span className="numeric">{formatByUnit(raw, metrics[keyName]?.unit ?? "ratio", t.units)}</span>
  );
}

const load = (code: string) =>
  Promise.all([
    getSchemeMetrics(code),
    getSchemeNav(code),
    getColumns(),
    getSchemeBehaviour(code),
    getSchemeExposure(code),
    getSchemeRollingExposure(code),
    getSchemeAttributes(code),
    // A refused comparison is shown in its own card, not as a failed page.
    getComparison(code).catch((error: unknown) => {
      if (error instanceof ApiError) return error.message;
      throw error;
    }),
  ]);

/**
 * Everything below the header loads in the browser from the fund's JSON. Rendered at
 * build time, the full page came to about 250 KB of HTML and RSC payload per fund, which
 * across every scheme would not fit GitHub Pages' 1 GB; the header, prerendered with a
 * one-line rolling return summary, is what search engines need.
 */
export function FundView({ detail, rolling }: { detail: SchemeDetail; rolling: RollingSpread[] }) {
  const i18n = useI18n();
  const { t, td } = i18n;
  const scheme = detail.scheme;
  useFundTitle(scheme.scheme_name);
  const summary = rollingSummary(rolling, i18n);
  const code = scheme.scheme_code;
  const [data, setData] = useState<Awaited<ReturnType<typeof load>> | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    load(code)
      .then((loaded) => !cancelled && setData(loaded))
      .catch((err: Error) => !cancelled && setError(err.message));
    return () => {
      cancelled = true;
    };
  }, [code]);

  const header = (
    <>
      <header className="grid gap-6 rounded-2xl border border-ink-200 bg-surface p-5 shadow-card sm:p-6 lg:grid-cols-[1fr_auto]">
        <div className="min-w-0 space-y-3">
          <p className="text-sm text-ink-500">{scheme.amc}</p>
          <h1 className="text-2xl font-semibold tracking-tight text-balance sm:text-3xl">
            {scheme.scheme_name}
          </h1>
          <div className="flex flex-wrap items-center gap-1.5">
            {scheme.is_active ? (
              <Badge tone="good">{t.fund.active}</Badge>
            ) : (
              <Badge tone="warn">{t.fund.inactiveShort}</Badge>
            )}
            {scheme.clean_sub_category ? <Badge>{scheme.clean_sub_category}</Badge> : null}
            <Badge>{String(scheme.clean_plan)}</Badge>
            <Badge>{String(scheme.clean_option)}</Badge>
          </div>
          <p className="text-xs text-ink-500">
            {t.fund.header.identity(
              scheme.scheme_code,
              scheme.isin_growth ?? scheme.isin_dividend ?? t.fund.header.noIsin,
            )}
          </p>
          {summary ? (
            <p className="max-w-3xl text-sm text-pretty text-ink-700">
              {summary}{" "}
              <a href="#rolling" className="whitespace-nowrap text-accent-600 hover:underline">
                {t.fund.header.fullDistribution}
              </a>
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2 pt-1 print:hidden">
            <Link
              href={`/compare?codes=${code}`}
              className="rounded-lg bg-accent-500 px-3.5 py-2 text-sm font-medium text-on-accent shadow-sm hover:bg-accent-600"
            >
              {t.fund.header.compare}
            </Link>
            <Button disabled={!data} onClick={() => window.print()}>
              {t.fund.header.print}
            </Button>
          </div>
        </div>
        <div className="flex flex-col justify-center gap-1 border-t border-ink-100 pt-5 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-8 lg:text-right">
          <p className="text-sm text-ink-500">{t.fund.header.latestNav}</p>
          <p className="text-3xl font-semibold tracking-tight numeric sm:text-4xl">
            {scheme.latest_nav === null ? "-" : `₹${scheme.latest_nav.toFixed(4)}`}
          </p>
          <p className="text-xs text-ink-500">
            {t.fund.header.asOf(scheme.latest_nav_date ?? "-")}
          </p>
        </div>
      </header>

      <CategoryChangeNote history={detail.category_history} />
    </>
  );

  if (!data) {
    return (
      <div className="space-y-5 print:hidden">
        {header}
        <p className={`mt-4 text-sm ${error ? "text-bad-700" : "text-ink-500"}`}>
          {error ?? t.fund.header.loading}
        </p>
      </div>
    );
  }
  const [metrics, nav, columnsMeta, behaviour, exposure, rollingExposure, attributes, comparison] =
    data;
  const specs = Object.fromEntries(columnsMeta.metrics.map((m) => [m.name, m])) as Record<
    string,
    MetricSpec
  >;
  const record = metrics as unknown as Record<string, unknown>;
  const flags = metrics.data_quality_flags;
  // Grouped by reason: one benchmark that is not mapped otherwise prints twenty near-identical lines.
  const missingByReason = new Map<string, string[]>();
  for (const [field, reason] of Object.entries(metrics.missing_reasons)) {
    missingByReason.set(reason, [...(missingByReason.get(reason) ?? []), field]);
  }

  return (
    <div className="space-y-5">
      {/* Hidden on paper: the one-page summary below is what prints instead. */}
      <div className="space-y-5 print:hidden">
        {header}

        <section aria-label={t.fund.glance.label} className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[1, 3, 5, 10].map((h) => (
            <div key={h} className="rounded-xl border border-ink-200 bg-surface p-4 shadow-card">
              <p className="text-xs text-ink-500">
                {h === 1 ? t.fund.glance.oneYear : t.fund.glance.perYear(h)}
              </p>
              <p className="mt-1 text-2xl font-semibold tracking-tight">
                <Cell record={record} keyName={`cagr_${h}y`} metrics={specs} />
              </p>
              <p className="mt-1 text-xs text-ink-500">
                {h === 1 ? (
                  t.fund.glance.peersFrom3
                ) : (
                  <>
                    {t.fund.glance.vsSimilar}{" "}
                    <span className="whitespace-nowrap">
                      <MetricValue
                        value={record[`fund_minus_category_${h}y`]}
                        spec={specs[`fund_minus_category_${h}y`]}
                        reason={metrics.missing_reasons[`fund_minus_category_${h}y`]}
                        reasonDescription={
                          metrics.missing_reason_descriptions[
                            metrics.missing_reasons[`fund_minus_category_${h}y`] ?? ""
                          ]
                        }
                      />
                    </span>
                  </>
                )}
              </p>
            </div>
          ))}
        </section>

        <nav
          aria-label={t.fund.onThisPage}
          className="glass -mx-1 flex gap-1 overflow-x-auto rounded-full p-1 text-sm lg:sticky lg:top-24 lg:z-30"
        >
          {SECTIONS.filter((id) => id !== "missing" || missingByReason.size).map((id) => (
            <a
              key={id}
              href={`#${id}`}
              className="shrink-0 rounded-full px-3 py-1.5 whitespace-nowrap text-ink-700 hover:bg-ink-900/5 hover:text-ink-900"
            >
              {t.fund.sections[id]}
            </a>
          ))}
        </nav>

        <section className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          <Stat
            label={t.fund.stats.aum}
            value={formatCrore(scheme.latest_aum, t.units)}
            hint={scheme.aum_quarter ?? t.fund.notPublished}
            tooltip={t.fund.stats.aumTooltip}
          />
          <Stat
            label={t.fund.stats.age}
            value={formatYears(scheme.fund_age_years, t.units)}
            hint={t.fund.stats.since(scheme.first_nav_date ?? "-")}
          />
          <Stat
            label={t.fund.stats.expenseRatio}
            value={formatPercent(scheme.expense_ratio)}
            hint={
              scheme.expense_ratio === null
                ? t.fund.notPublished
                : t.fund.stats.plan(String(scheme.clean_plan))
            }
          />
          <Stat
            label={t.fund.stats.comparableMonths}
            value={metrics.monthly_obs_count ?? "-"}
            hint={t.fund.stats.gapMonths(i18n.number(metrics.nav_gap_months ?? 0))}
          />
          <Stat
            label={t.fund.stats.metricsAsOf}
            value={metrics.as_of_date}
            hint={`v${metrics.methodology_version}`}
          />
          <Stat
            label={t.fund.stats.benchmark}
            value={
              detail.benchmark ? (
                <span className="flex items-center gap-1.5">
                  <span className="truncate text-base">{detail.benchmark.benchmark_id}</span>
                  {detail.benchmark.comparable_with_inr_funds ? null : (
                    <Badge tone="bad">{detail.benchmark.currency}</Badge>
                  )}
                </span>
              ) : (
                "-"
              )
            }
            hint={
              detail.benchmark
                ? detail.benchmark.comparable_with_inr_funds
                  ? `${detail.benchmark.currency} · ${detail.benchmark.source}`
                  : t.fund.stats.notComparable(detail.benchmark.fund_currency)
                : t.fund.notMapped
            }
          />
        </section>

        {flags.length ? (
          <Card title={t.fund.dataQuality}>
            <div className="flex flex-wrap gap-2">
              {flags.map((flag) => (
                <Badge key={flag} tone="warn">
                  {td(flag.replaceAll("_", " "))}
                </Badge>
              ))}
            </div>
          </Card>
        ) : null}

        <Card id="returns" title={t.fund.returns.title} subtitle={t.fund.returns.subtitle}>
          <BenchmarkCurrencyNote
            benchmark={detail.benchmark}
            computedAgainst={metrics.benchmark_id}
          />
          <div className="overflow-x-auto">
            <table className="w-full min-w-[40rem] text-sm [&_td]:pr-3">
              <thead className="text-left text-xs uppercase tracking-wide text-ink-500 [&_th]:pr-3">
                <tr>
                  <th className="py-1">{t.fund.returns.horizon}</th>
                  <th>{t.fund.returns.fundCagr}</th>
                  <th>{t.fund.returns.subCategoryCagr}</th>
                  <th>{t.fund.returns.excess}</th>
                  <th>{t.fund.returns.ratio}</th>
                  <th>{t.fund.returns.peers}</th>
                  <th>{t.fund.returns.benchmarkCagr}</th>
                  <th>{t.fund.returns.excessBenchmark}</th>
                </tr>
              </thead>
              <tbody>
                {[1, 3, 5, 10].map((h) => (
                  <tr key={h} className="border-t border-ink-100">
                    <td className="py-1.5 font-medium">{t.fund.horizon(h)}</td>
                    <td>
                      <Cell record={record} keyName={`cagr_${h}y`} metrics={specs} />
                    </td>
                    <td>
                      {h === 1 ? (
                        <span className="text-ink-300">-</span>
                      ) : (
                        <Cell record={record} keyName={`category_return_${h}y`} metrics={specs} />
                      )}
                    </td>
                    <td>
                      {h === 1 ? (
                        <span className="text-ink-300">-</span>
                      ) : (
                        <Cell
                          record={record}
                          keyName={`fund_minus_category_${h}y`}
                          metrics={specs}
                        />
                      )}
                    </td>
                    <td>
                      {h === 1 ? (
                        <span className="text-ink-300">-</span>
                      ) : (
                        <Cell record={record} keyName={`fund_div_category_${h}y`} metrics={specs} />
                      )}
                    </td>
                    <td className="numeric text-ink-500">
                      {h === 1 ? "-" : `n=${String(record[`category_peer_count_${h}y`] ?? 0)}`}
                    </td>
                    <td>
                      {h === 1 ? (
                        <span className="text-ink-300">-</span>
                      ) : (
                        <Cell record={record} keyName={`benchmark_return_${h}y`} metrics={specs} />
                      )}
                    </td>
                    <td>
                      {h === 1 ? (
                        <span className="text-ink-300">-</span>
                      ) : (
                        <Cell
                          record={record}
                          keyName={`fund_minus_benchmark_${h}y`}
                          metrics={specs}
                        />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-ink-500">{t.fund.returns.note}</p>
        </Card>

        <div id="charts">
          <FundCharts schemeCode={code} navPoints={nav.points} />
        </div>

        <Card id="rolling" title={t.fund.rolling.title} subtitle={t.fund.rolling.subtitle}>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[40rem] text-sm [&_td]:pr-3">
              <thead className="text-left text-xs uppercase tracking-wide text-ink-500 [&_th]:pr-3">
                <tr>
                  <th className="py-1">{t.fund.returns.horizon}</th>
                  {ROLLING_STATS.map((stat) => (
                    <th key={stat}>{t.fund.rolling.stats[stat]}</th>
                  ))}
                  <th>{t.fund.rolling.beatSubCategory}</th>
                  <th>{t.fund.rolling.beatBenchmark}</th>
                  <th>{t.fund.rolling.windows}</th>
                </tr>
              </thead>
              <tbody>
                {HORIZONS.map((h) => (
                  <tr key={h} className="border-t border-ink-100">
                    <td className="py-1.5 font-medium">{t.fund.horizon(h)}</td>
                    {ROLLING_STATS.map((stat) => (
                      <td key={stat}>
                        <Cell record={record} keyName={`rolling_${h}y_${stat}`} metrics={specs} />
                      </td>
                    ))}
                    <td>
                      <Cell
                        record={record}
                        keyName={`rolling_${h}y_beat_category_pct`}
                        metrics={specs}
                      />
                    </td>
                    <td>
                      <Cell
                        record={record}
                        keyName={`rolling_${h}y_beat_benchmark_pct`}
                        metrics={specs}
                      />
                    </td>
                    <td className="numeric text-ink-500">
                      n={String(record[`rolling_${h}y_window_count`] ?? 0)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <Card id="risk" title={t.fund.risk.title} subtitle={t.fund.risk.subtitle}>
          <BenchmarkCurrencyNote
            benchmark={detail.benchmark}
            computedAgainst={metrics.benchmark_id}
          />
          <div className="overflow-x-auto">
            <table className="w-full min-w-[40rem] text-sm [&_td]:pr-3">
              <thead className="text-left text-xs uppercase tracking-wide text-ink-500 [&_th]:pr-3">
                <tr>
                  <th className="py-1">{t.fund.risk.metric}</th>
                  {HORIZONS.map((h) => (
                    <th key={h}>{t.fund.horizon(h)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {RISK_ROWS.map((row) => {
                  const label = t.fund.risk.rows[row];
                  const plain = plainRowLabel(specs[`${row}_5y`]);
                  return (
                    <tr key={row} className="border-t border-ink-100">
                      <td className="py-1.5">
                        <div>{plain === null ? label : td(plain)}</div>
                        <div className="text-[11px] text-ink-500">{label}</div>
                      </td>
                      {HORIZONS.map((h) => (
                        <td key={h}>
                          <Cell record={record} keyName={`${row}_${h}y`} metrics={specs} />
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>

        <div id="behaviour" className="space-y-5">
          <ExposurePanel exposure={exposure} />
          <StyleDriftPanel rolling={rollingExposure} />
          <DrawdownHistory behaviour={behaviour} />
          <CalendarYears behaviour={behaviour} />
          <CostPanel behaviour={behaviour} />
        </div>

        <div id="peers" className="space-y-5">
          <SchemeAttributesPanel attributes={attributes} />
          <PeerComparison comparison={comparison} />
        </div>

        {missingByReason.size ? (
          <Card id="missing" title={t.fund.missing.title} subtitle={t.fund.missing.subtitle}>
            <ul className="space-y-3 text-sm">
              {[...missingByReason.entries()].map(([reason, fields]) => (
                <li key={reason} className="border-b border-ink-100 pb-3 last:border-0 last:pb-0">
                  <p className="text-ink-900">
                    {td(metrics.missing_reason_descriptions[reason] ?? reason)}
                  </p>
                  <p className="mt-1 font-mono text-[11px] leading-relaxed text-ink-500">
                    {fields.join(", ")}
                  </p>
                </li>
              ))}
            </ul>
          </Card>
        ) : null}

        <p className="text-xs text-ink-500">
          <Link href="/methodology" className="text-accent-600 hover:underline">
            {t.fund.howComputed}
          </Link>
          {t.fund.notForecast}
        </p>
      </div>
      <Tearsheet
        className="hidden print:block"
        scheme={scheme}
        metrics={metrics}
        record={record}
        specs={specs}
        behaviour={behaviour}
        exposure={exposure}
        rollingExposure={rollingExposure}
        benchmark={detail.benchmark}
        disclaimer={detail.disclaimer}
        missingByReason={[...missingByReason.entries()]}
      />
    </div>
  );
}
