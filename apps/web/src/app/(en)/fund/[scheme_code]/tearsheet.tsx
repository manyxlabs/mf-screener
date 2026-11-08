import {
  formatByUnit,
  formatCrore,
  formatDuration,
  formatPercent,
  formatYears,
  type Behaviour,
  type Benchmark,
  type Exposure,
  type MetricSpec,
  type MetricsSnapshot,
  type Scheme,
} from "@mf/shared";
import type { RollingExposure } from "@/lib/api";
import type { I18n } from "@/lib/i18n/core";
import { useI18n } from "@/lib/i18n/client";
import type { Messages } from "@/messages/en";

const DASH = "-";

// A separate, smaller set than the full risk table on the page above: this is a
// one-page summary, not a reprint of it, and importing the page's own list would make
// this file and page.tsx import each other. Keyed by the metric without its horizon.
const RISK_ROWS: (keyof Messages["fund"]["print"]["risk"])[] = [
  "sharpe",
  "sortino",
  "volatility",
  "max_drawdown",
  "calmar",
  "alpha",
  "beta",
  "tracking_error",
];

const HORIZONS = [3, 5, 10] as const;

function fmt(
  record: Record<string, unknown>,
  key: string,
  specs: Record<string, MetricSpec>,
  { t }: I18n,
) {
  const raw = record[key];
  if (typeof raw !== "number") return DASH;
  return formatByUnit(raw, specs[key]?.unit ?? "ratio", t.units);
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="break-inside-avoid border-t border-black/20 pt-1 first:border-0 first:pt-0">
      <h2 className="text-[8px] font-bold uppercase tracking-wide">{title}</h2>
      {children}
    </section>
  );
}

export interface TearsheetProps {
  scheme: Scheme;
  metrics: MetricsSnapshot;
  record: Record<string, unknown>;
  specs: Record<string, MetricSpec>;
  behaviour: Behaviour;
  exposure: Exposure;
  rollingExposure: RollingExposure;
  benchmark: Benchmark | null;
  disclaimer: string;
  missingByReason: [string, string[]][];
  className?: string;
}

/**
 * A one-page, print-only render of every panel on the fund page above, condensed to
 * fit a single sheet: identity, returns, rolling distribution, risk, drawdowns, cost,
 * style exposure and the missing-data reasons. Kept invisible on screen (the parent
 * gives it `hidden print:block`) so it never duplicates the interactive page.
 */
export function Tearsheet({
  scheme,
  metrics,
  record,
  specs,
  behaviour,
  exposure,
  rollingExposure,
  benchmark,
  disclaimer,
  missingByReason,
  className = "",
}: TearsheetProps) {
  const i18n = useI18n();
  const { t, td } = i18n;
  const words = t.fund.print;
  const cell = (key: string) => fmt(record, key, specs, i18n);
  const drift = rollingExposure.style_drift_3y;
  const worstDrawdowns = behaviour.drawdowns.slice(0, 3);
  return (
    <div className={`tearsheet-page space-y-1.5 text-[8px] leading-tight ${className}`}>
      <header className="flex items-baseline justify-between gap-2">
        <div>
          <h1 className="text-[12px] font-bold">{scheme.scheme_name}</h1>
          <p>
            {scheme.amc ?? "-"} &middot; {scheme.clean_sub_category ?? "-"} &middot;{" "}
            {words.code(scheme.scheme_code)} &middot; {scheme.clean_plan}/{scheme.clean_option}{" "}
            &middot; {scheme.is_active ? t.fund.active : t.fund.inactive}
          </p>
        </div>
        <p className="shrink-0 text-right">
          {words.nav(scheme.latest_nav?.toFixed(4) ?? DASH, scheme.latest_nav_date ?? DASH)}
          <br />
          {words.aum(
            formatCrore(scheme.latest_aum, t.units),
            formatYears(scheme.fund_age_years, t.units),
          )}
          <br />
          {words.ter(
            formatPercent(scheme.expense_ratio),
            !benchmark
              ? t.fund.notMapped
              : benchmark.comparable_with_inr_funds
                ? benchmark.benchmark_id
                : words.notComparable(benchmark.benchmark_id, benchmark.currency),
          )}
        </p>
      </header>

      <Section title={words.trailing}>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr>
                <th className="text-left font-normal">{t.fund.returns.horizon}</th>
                <th className="text-left font-normal">{t.charts.fund}</th>
                <th className="text-left font-normal">{words.subCategory}</th>
                <th className="text-left font-normal">{t.fund.stats.benchmark}</th>
              </tr>
            </thead>
            <tbody>
              {[1, 3, 5, 10].map((h) => (
                <tr key={h}>
                  <td>{t.fund.horizon(h)}</td>
                  <td>{cell(`cagr_${h}y`)}</td>
                  <td>{h === 1 ? DASH : cell(`category_return_${h}y`)}</td>
                  <td>{h === 1 ? DASH : cell(`benchmark_return_${h}y`)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section title={t.fund.rolling.title}>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr>
                <th className="text-left font-normal">{t.fund.returns.horizon}</th>
                <th className="text-left font-normal">{words.mean}</th>
                <th className="text-left font-normal">{words.positive}</th>
                <th className="text-left font-normal">{words.beatSubCategory}</th>
                <th className="text-left font-normal">{words.beatBenchmark}</th>
                <th className="text-left font-normal">{t.fund.rolling.windows}</th>
              </tr>
            </thead>
            <tbody>
              {HORIZONS.map((h) => (
                <tr key={h}>
                  <td>{t.fund.horizon(h)}</td>
                  <td>{cell(`rolling_${h}y_mean`)}</td>
                  <td>{cell(`rolling_${h}y_positive_pct`)}</td>
                  <td>{cell(`rolling_${h}y_beat_category_pct`)}</td>
                  <td>{cell(`rolling_${h}y_beat_benchmark_pct`)}</td>
                  <td>{String(record[`rolling_${h}y_window_count`] ?? 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section title={t.fund.risk.title}>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr>
                <th className="text-left font-normal">{t.fund.risk.metric}</th>
                {HORIZONS.map((h) => (
                  <th key={h} className="text-left font-normal">
                    {t.fund.horizon(h)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {RISK_ROWS.map((row) => (
                <tr key={row}>
                  <td>{words.risk[row]}</td>
                  {HORIZONS.map((h) => (
                    <td key={h}>{cell(`${row}_${h}y`)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section title={t.fund.drawdowns.title}>
        {worstDrawdowns.length === 0 ? (
          <p>{words.noFall(formatPercent(behaviour.min_drawdown_depth, 0))}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr>
                  <th className="text-left font-normal">{t.fund.drawdowns.fall}</th>
                  <th className="text-left font-normal">{t.fund.drawdowns.from}</th>
                  <th className="text-left font-normal">{t.fund.drawdowns.to}</th>
                  <th className="text-left font-normal">{t.fund.drawdowns.backToEven}</th>
                </tr>
              </thead>
              <tbody>
                {worstDrawdowns.map((episode) => (
                  <tr key={episode.peak_date}>
                    <td>{formatPercent(episode.depth)}</td>
                    <td>{episode.peak_date}</td>
                    <td>{episode.trough_date}</td>
                    <td>
                      {episode.days_to_recover === null
                        ? t.fund.drawdowns.stillBelow
                        : formatDuration(episode.days_to_recover, t.units)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {behaviour.drawdowns.length > worstDrawdowns.length ? (
          <p>{words.moreFalls(behaviour.drawdowns.length - worstDrawdowns.length)}</p>
        ) : null}
        <p>
          {words.capture(
            behaviour.capture.up === null
              ? words.captureUnavailable(behaviour.capture.reason)
              : `${formatPercent(behaviour.capture.up, 0)} / ${formatPercent(behaviour.capture.down, 0)}`,
          )}
        </p>
      </Section>

      <Section title={words.cost}>
        {behaviour.cost.expense_ratio === null || behaviour.cost.category_median === null ? (
          <p>
            {behaviour.cost.expense_ratio === null
              ? words.noTer
              : words.tooFew(behaviour.cost.category_count)}
          </p>
        ) : (
          <p>
            {words.costLine(
              formatPercent(behaviour.cost.expense_ratio, 2),
              formatPercent(behaviour.cost.category_median, 2),
              behaviour.cost.category_count,
              behaviour.cost.horizon_years,
              behaviour.cost.shortfall_vs_median === null
                ? DASH
                : formatPercent(behaviour.cost.shortfall_vs_median, 2),
            )}
          </p>
        )}
      </Section>

      <Section title={words.exposure}>
        {exposure.weights.length === 0 ? (
          <p>
            {words.noExposure(
              td(
                (exposure.reason && metrics.missing_reason_descriptions[exposure.reason]) ??
                  exposure.reason ??
                  words.notEnoughHistory,
              ),
            )}
          </p>
        ) : (
          <p>
            {words.fit(
              exposure.weights
                .map((w) => `${w.benchmark_name} ${formatPercent(w.weight, 0)}`)
                .join(", "),
              exposure.r_squared === null ? DASH : exposure.r_squared.toFixed(2),
              exposure.months,
              drift.value === null ? DASH : formatPercent(drift.value, 1),
            )}
          </p>
        )}
      </Section>

      {missingByReason.length ? (
        <Section title={words.missing}>
          <ul>
            {missingByReason.map(([reason, fields]) => (
              <li key={reason}>
                {td(metrics.missing_reason_descriptions[reason] ?? reason)}: {fields.join(", ")}
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      <footer className="border-t border-black/20 pt-1">
        <p>{words.methodology(metrics.methodology_version, metrics.as_of_date)}</p>
        <p>{td(disclaimer)}</p>
      </footer>
    </div>
  );
}
