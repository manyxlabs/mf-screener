import {
  formatByUnit,
  formatCrore,
  formatPercent,
  formatYears,
  type Benchmark,
  type MetricSpec,
  type SchemeDetail,
} from "@mf/shared";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Card, Stat } from "@/components/ui";
import {
  getColumns,
  getScheme,
  getSchemeBehaviour,
  getSchemeExposure,
  getSchemeMetrics,
  getSchemeNav,
  getSchemeRollingExposure,
} from "@/lib/api";
import { ApiError } from "@/lib/api";
import {
  CalendarYears,
  CostPanel,
  DrawdownHistory,
  ExposurePanel,
  StyleDriftPanel,
} from "./behaviour-panels";
import { FundCharts } from "./fund-charts";
import { Tearsheet } from "./tearsheet";
import { PeerComparison } from "./peer-comparison";
import { getSchemeAttributes, SchemeAttributesPanel } from "./scheme-attributes-panel";

export const dynamic = "force-dynamic";

const RISK_ROWS: { label: string; keys: [string, string, string] }[] = [
  { label: "Sharpe", keys: ["sharpe_3y", "sharpe_5y", "sharpe_10y"] },
  { label: "Sortino", keys: ["sortino_3y", "sortino_5y", "sortino_10y"] },
  { label: "Volatility (annualised)", keys: ["volatility_3y", "volatility_5y", "volatility_10y"] },
  {
    label: "Downside deviation",
    keys: ["downside_deviation_3y", "downside_deviation_5y", "downside_deviation_10y"],
  },
  { label: "Maximum drawdown", keys: ["max_drawdown_3y", "max_drawdown_5y", "max_drawdown_10y"] },
  { label: "Calmar", keys: ["calmar_3y", "calmar_5y", "calmar_10y"] },
  {
    label: "Tracking error",
    keys: ["tracking_error_3y", "tracking_error_5y", "tracking_error_10y"],
  },
  { label: "Alpha (annualised)", keys: ["alpha_3y", "alpha_5y", "alpha_10y"] },
  { label: "Beta", keys: ["beta_3y", "beta_5y", "beta_10y"] },
  { label: "R-squared", keys: ["r_squared_3y", "r_squared_5y", "r_squared_10y"] },
  {
    label: "Information ratio vs sub-category",
    keys: [
      "information_ratio_vs_category_3y",
      "information_ratio_vs_category_5y",
      "information_ratio_vs_category_10y",
    ],
  },
  {
    label: "Information ratio vs benchmark",
    keys: [
      "information_ratio_vs_benchmark_3y",
      "information_ratio_vs_benchmark_5y",
      "information_ratio_vs_benchmark_10y",
    ],
  },
];

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
 * Shown wherever a benchmark-relative number would otherwise sit. Every such metric is
 * already null when the currencies differ, but a column of dashes reads as "no data
 * yet" and invites someone to go and load the very series that must not be used. This
 * says which series is mapped, that it is in the wrong currency, and that the gap is
 * deliberate.
 */
function CategoryChangeNote({ history }: { history: SchemeDetail["category_history"] }) {
  // One entry is the normal case: observed once, never seen to change.
  const from = history[0];
  const to = history[history.length - 1];
  if (!from || !to || from === to) return null;
  return (
    <p className="mb-3 rounded border border-warn-300 bg-warn-50 px-3 py-2 text-xs text-warn-900">
      <span aria-hidden="true">⚠ </span>
      This fund changed category on <span className="font-medium">{to.valid_from}</span>, from{" "}
      <span className="font-medium">{from.clean_sub_category ?? from.clean_category}</span> to{" "}
      <span className="font-medium">{to.clean_sub_category ?? to.clean_category}</span>. Every
      figure below that compares this fund to its peers spans both periods, so the peer group it is
      measured against is not the same one throughout the window.
    </p>
  );
}

function BenchmarkCurrencyNote({
  benchmark,
  computedAgainst,
}: {
  benchmark: Benchmark | null;
  computedAgainst: string | null;
}) {
  const wrapper = "mb-3 rounded border border-bad-300 bg-bad-50 px-3 py-2 text-xs text-bad-900";
  if (benchmark && !benchmark.comparable_with_inr_funds) {
    return (
      <p className={wrapper}>
        <span aria-hidden="true">⚠ </span>
        Benchmark-relative metrics are withheld. This fund is mapped to{" "}
        <span className="font-medium">{benchmark.benchmark_id}</span>, which is quoted in{" "}
        {benchmark.currency}, while the NAV is in {benchmark.fund_currency}. The difference between
        them would include the exchange rate, not just performance, so no alpha, beta, tracking
        error, benchmark information ratio or benchmark excess return is computed. Import an{" "}
        {benchmark.fund_currency}-converted series to compare against this index.
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
        Benchmark figures below were computed against{" "}
        <span className="font-medium">{computedAgainst}</span>, but this fund is now mapped to{" "}
        <span className="font-medium">{benchmark.benchmark_id}</span>. Run{" "}
        <code className="rounded bg-bad-100 px-1">make metrics</code> to recompute them; until then
        treat every benchmark-relative number here as out of date.
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
        title={(reason ? descriptions[reason] : undefined) ?? reason ?? "Not available"}
      >
        -
      </span>
    );
  }
  return <span className="numeric">{formatByUnit(raw, metrics[keyName]?.unit ?? "ratio")}</span>;
}

/** A fund the source lists but nothing can be computed for. Not an error page. */
function NoMetrics({ scheme, reason }: { scheme: SchemeDetail["scheme"]; reason: string }) {
  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">{scheme.scheme_name}</h1>
        <p className="mt-1 text-sm text-ink-500">
          {scheme.amc} · {scheme.clean_sub_category} · scheme code {scheme.scheme_code}
        </p>
      </header>
      <Card title="No metrics for this scheme">
        <p className="text-sm text-ink-700">{reason}</p>
        <dl className="mt-4 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
          {[
            ["Status", scheme.is_active ? "Active" : "Inactive or matured"],
            [
              "NAV dates published",
              `${scheme.first_nav_date ?? "-"} to ${scheme.last_nav_date ?? "-"}`,
            ],
            ["Plan / option", `${scheme.clean_plan} / ${scheme.clean_option}`],
            ["Category", scheme.clean_category ?? "-"],
          ].map(([label, value]) => (
            <div key={label} className="flex justify-between gap-4 border-b border-ink-100 py-1">
              <dt className="text-ink-500">{label}</dt>
              <dd className="text-right text-ink-900">{value}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-4 text-xs text-ink-500">
          The scheme is kept in the raw data exactly as the source publishes it. It is excluded from
          screens and peer groups because no return can be formed from it, not because it was
          filtered out by a preference.{" "}
          <Link href="/methodology" className="text-accent-600 hover:underline">
            Methodology
          </Link>
        </p>
      </Card>
    </div>
  );
}

export default async function FundPage({ params }: { params: Promise<{ scheme_code: string }> }) {
  const { scheme_code: code } = await params;
  let detail;
  try {
    detail = await getScheme(code);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }
  if (detail.metrics_unavailable) {
    return <NoMetrics scheme={detail.scheme} reason={detail.metrics_unavailable.description} />;
  }
  // Only after the scheme is known to have metrics, so the three that need it stay in
  // one round trip rather than one of them 404ing for a fund that can never have them.
  let metrics, nav, columnsMeta, behaviour, exposure, rollingExposure, attributes;
  try {
    [metrics, nav, columnsMeta, behaviour, exposure, rollingExposure, attributes] =
      await Promise.all([
        getSchemeMetrics(code),
        getSchemeNav(code, "monthly"),
        getColumns(),
        getSchemeBehaviour(code),
        getSchemeExposure(code),
        getSchemeRollingExposure(code),
        getSchemeAttributes(code),
      ]);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }
  const specs = Object.fromEntries(columnsMeta.metrics.map((m) => [m.name, m])) as Record<
    string,
    MetricSpec
  >;
  const scheme = detail.scheme;
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
      <div className="print:hidden">
        <header>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold tracking-tight">{scheme.scheme_name}</h1>
            {scheme.is_active ? (
              <Badge tone="good">Active</Badge>
            ) : (
              <Badge tone="warn">Inactive / matured</Badge>
            )}
            <Badge>{String(scheme.clean_plan)}</Badge>
            <Badge>{String(scheme.clean_option)}</Badge>
          </div>
          <p className="mt-1 text-sm text-ink-500">
            {scheme.amc} · {scheme.clean_sub_category} · scheme code {scheme.scheme_code} ·{" "}
            {scheme.isin_growth ?? scheme.isin_dividend ?? "no ISIN published"}
          </p>
        </header>

        <CategoryChangeNote history={detail.category_history} />

        <section className="grid grid-cols-2 gap-3 lg:grid-cols-6">
          <Stat
            label="Latest NAV"
            value={scheme.latest_nav?.toFixed(4) ?? "-"}
            hint={scheme.latest_nav_date ?? ""}
          />
          <Stat
            label="Scheme AAUM (Quarterly Average, ₹ Cr)"
            value={formatCrore(scheme.latest_aum)}
            hint={scheme.aum_quarter ?? "not published"}
            tooltip="This is AMFI quarterly average AUM for this exact scheme variant, such as Direct Growth. It is not a current month-end AUM and does not include related Direct/Regular or Growth/IDCW variants."
          />
          <Stat
            label="Fund age"
            value={formatYears(scheme.fund_age_years)}
            hint={`from ${scheme.first_nav_date ?? "-"}`}
          />
          <Stat
            label="Expense ratio"
            value={formatPercent(scheme.expense_ratio)}
            hint={scheme.expense_ratio === null ? "not published" : `${scheme.clean_plan} plan`}
          />
          <Stat
            label="Comparable months"
            value={metrics.monthly_obs_count ?? "-"}
            hint={`${metrics.nav_gap_months ?? 0} gap months`}
          />
          <Stat
            label="Metrics as of"
            value={metrics.as_of_date}
            hint={`v${metrics.methodology_version}`}
          />
          <Stat
            label="Benchmark"
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
                  : `not comparable with ${detail.benchmark.fund_currency} returns`
                : "not mapped"
            }
          />
        </section>

        {flags.length ? (
          <Card title="Data quality flags">
            <div className="flex flex-wrap gap-2">
              {flags.map((flag) => (
                <Badge key={flag} tone="warn">
                  {flag.replaceAll("_", " ")}
                </Badge>
              ))}
            </div>
          </Card>
        ) : null}

        <Card title="Trailing returns" subtitle="Annualised, from month-end NAV to month-end NAV.">
          <BenchmarkCurrencyNote
            benchmark={detail.benchmark}
            computedAgainst={metrics.benchmark_id}
          />
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-ink-500">
              <tr>
                <th className="py-1">Horizon</th>
                <th>Fund CAGR</th>
                <th>Sub-category CAGR</th>
                <th>Excess (pp)</th>
                <th>Ratio</th>
                <th>Peers</th>
                <th>Benchmark CAGR</th>
                <th>Excess vs benchmark (pp)</th>
              </tr>
            </thead>
            <tbody>
              {[1, 3, 5, 10].map((h) => (
                <tr key={h} className="border-t border-ink-100">
                  <td className="py-1.5 font-medium">{h}Y</td>
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
                      <Cell record={record} keyName={`fund_minus_category_${h}y`} metrics={specs} />
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
          <p className="mt-2 text-xs text-ink-500">
            Peer and benchmark comparisons are stored for 3Y, 5Y and 10Y only. The live peer
            comparison below covers 1Y as well.
          </p>
        </Card>

        <FundCharts schemeCode={code} navPoints={nav.points} />

        <Card
          title="Rolling return distribution"
          subtitle="Every overlapping window in the fund's comparable history."
        >
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-ink-500">
              <tr>
                <th className="py-1">Horizon</th>
                {ROLLING_STATS.map((stat) => (
                  <th key={stat}>{stat.replace("_pct", " %").replace("std", "dispersion")}</th>
                ))}
                <th>Beat sub-category</th>
                <th>Beat benchmark</th>
                <th>Windows</th>
              </tr>
            </thead>
            <tbody>
              {[3, 5, 10].map((h) => (
                <tr key={h} className="border-t border-ink-100">
                  <td className="py-1.5 font-medium">{h}Y</td>
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
        </Card>

        <Card
          title="Risk and risk-adjusted metrics"
          subtitle="Monthly observations, annualised by sqrt(12). Maximum drawdown uses daily NAV."
        >
          <BenchmarkCurrencyNote
            benchmark={detail.benchmark}
            computedAgainst={metrics.benchmark_id}
          />
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-ink-500">
              <tr>
                <th className="py-1">Metric</th>
                <th>3Y</th>
                <th>5Y</th>
                <th>10Y</th>
              </tr>
            </thead>
            <tbody>
              {RISK_ROWS.map((row) => (
                <tr key={row.label} className="border-t border-ink-100">
                  <td className="py-1.5">
                    <div>{plainRowLabel(specs[row.keys[1]]) ?? row.label}</div>
                    <div className="text-[11px] text-ink-500">{row.label}</div>
                  </td>
                  {row.keys.map((key) => (
                    <td key={key}>
                      <Cell record={record} keyName={key} metrics={specs} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </Card>

        <ExposurePanel exposure={exposure} />

        <StyleDriftPanel rolling={rollingExposure} />

        <DrawdownHistory behaviour={behaviour} />

        <CalendarYears behaviour={behaviour} />

        <CostPanel behaviour={behaviour} />

        <SchemeAttributesPanel attributes={attributes} />

        <PeerComparison schemeCode={code} />

        {missingByReason.size ? (
          <Card
            title="Why is a score missing?"
            subtitle="Every blank on this page traces to one of these reasons."
          >
            <ul className="space-y-3 text-sm">
              {[...missingByReason.entries()].map(([reason, fields]) => (
                <li key={reason} className="border-b border-ink-100 pb-3 last:border-0 last:pb-0">
                  <p className="text-ink-900">
                    {metrics.missing_reason_descriptions[reason] ?? reason}
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
            Read how every one of these numbers is computed
          </Link>
          . Past returns are not a forecast.
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
