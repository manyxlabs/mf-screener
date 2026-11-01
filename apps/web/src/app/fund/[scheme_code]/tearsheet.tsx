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
  pluralise,
} from "@mf/shared";
import type { RollingExposure } from "@/lib/api";

const DASH = "-";

// A separate, smaller set than the full risk table on the page above: this is a
// one-page summary, not a reprint of it, and importing the page's own list would make
// this file and page.tsx import each other.
const RISK_ROWS: { label: string; keys: [string, string, string] }[] = [
  { label: "Sharpe", keys: ["sharpe_3y", "sharpe_5y", "sharpe_10y"] },
  { label: "Sortino", keys: ["sortino_3y", "sortino_5y", "sortino_10y"] },
  { label: "Volatility", keys: ["volatility_3y", "volatility_5y", "volatility_10y"] },
  { label: "Max drawdown", keys: ["max_drawdown_3y", "max_drawdown_5y", "max_drawdown_10y"] },
  { label: "Calmar", keys: ["calmar_3y", "calmar_5y", "calmar_10y"] },
  { label: "Alpha", keys: ["alpha_3y", "alpha_5y", "alpha_10y"] },
  { label: "Beta", keys: ["beta_3y", "beta_5y", "beta_10y"] },
  {
    label: "Tracking error",
    keys: ["tracking_error_3y", "tracking_error_5y", "tracking_error_10y"],
  },
];

function fmt(record: Record<string, unknown>, key: string, specs: Record<string, MetricSpec>) {
  const raw = record[key];
  if (typeof raw !== "number") return DASH;
  return formatByUnit(raw, specs[key]?.unit ?? "ratio");
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
  const drift = rollingExposure.style_drift_3y;
  const worstDrawdowns = behaviour.drawdowns.slice(0, 3);
  return (
    <div className={`tearsheet-page space-y-1.5 text-[8px] leading-tight ${className}`}>
      <header className="flex items-baseline justify-between gap-2">
        <div>
          <h1 className="text-[12px] font-bold">{scheme.scheme_name}</h1>
          <p>
            {scheme.amc ?? "-"} &middot; {scheme.clean_sub_category ?? "-"} &middot; code{" "}
            {scheme.scheme_code} &middot; {scheme.clean_plan}/{scheme.clean_option} &middot;{" "}
            {scheme.is_active ? "Active" : "Inactive or matured"}
          </p>
        </div>
        <p className="shrink-0 text-right">
          NAV {scheme.latest_nav?.toFixed(4) ?? DASH} ({scheme.latest_nav_date ?? DASH})
          <br />
          AUM {formatCrore(scheme.latest_aum)} &middot; age {formatYears(scheme.fund_age_years)}
          <br />
          TER {formatPercent(scheme.expense_ratio)} &middot; benchmark{" "}
          {benchmark ? benchmark.benchmark_id : "not mapped"}
          {benchmark && !benchmark.comparable_with_inr_funds
            ? ` (${benchmark.currency}, not comparable)`
            : ""}
        </p>
      </header>

      <Section title="Trailing returns (annualised)">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr>
                <th className="text-left font-normal">Horizon</th>
                <th className="text-left font-normal">Fund</th>
                <th className="text-left font-normal">Sub-cat.</th>
                <th className="text-left font-normal">Benchmark</th>
              </tr>
            </thead>
            <tbody>
              {[1, 3, 5, 10].map((h) => (
                <tr key={h}>
                  <td>{h}Y</td>
                  <td>{fmt(record, `cagr_${h}y`, specs)}</td>
                  <td>{h === 1 ? DASH : fmt(record, `category_return_${h}y`, specs)}</td>
                  <td>{h === 1 ? DASH : fmt(record, `benchmark_return_${h}y`, specs)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section title="Rolling return distribution">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr>
                <th className="text-left font-normal">Horizon</th>
                <th className="text-left font-normal">Mean</th>
                <th className="text-left font-normal">Positive %</th>
                <th className="text-left font-normal">Beat sub-cat.</th>
                <th className="text-left font-normal">Beat bmk.</th>
                <th className="text-left font-normal">Windows</th>
              </tr>
            </thead>
            <tbody>
              {[3, 5, 10].map((h) => (
                <tr key={h}>
                  <td>{h}Y</td>
                  <td>{fmt(record, `rolling_${h}y_mean`, specs)}</td>
                  <td>{fmt(record, `rolling_${h}y_positive_pct`, specs)}</td>
                  <td>{fmt(record, `rolling_${h}y_beat_category_pct`, specs)}</td>
                  <td>{fmt(record, `rolling_${h}y_beat_benchmark_pct`, specs)}</td>
                  <td>{String(record[`rolling_${h}y_window_count`] ?? 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section title="Risk and risk-adjusted metrics">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr>
                <th className="text-left font-normal">Metric</th>
                <th className="text-left font-normal">3Y</th>
                <th className="text-left font-normal">5Y</th>
                <th className="text-left font-normal">10Y</th>
              </tr>
            </thead>
            <tbody>
              {RISK_ROWS.map((row) => (
                <tr key={row.label}>
                  <td>{row.label}</td>
                  {row.keys.map((key) => (
                    <td key={key}>{fmt(record, key, specs)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section title="Falls and recoveries">
        {worstDrawdowns.length === 0 ? (
          <p>No fall of {formatPercent(behaviour.min_drawdown_depth, 0)} or more on record.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr>
                  <th className="text-left font-normal">Fall</th>
                  <th className="text-left font-normal">From</th>
                  <th className="text-left font-normal">To</th>
                  <th className="text-left font-normal">Back to even</th>
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
                        ? "still below this peak"
                        : formatDuration(episode.days_to_recover)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {behaviour.drawdowns.length > worstDrawdowns.length ? (
          <p>{behaviour.drawdowns.length - worstDrawdowns.length} more fall(s), see full page.</p>
        ) : null}
        <p>
          Up/down capture:{" "}
          {behaviour.capture.up === null
            ? `not available (${behaviour.capture.reason ?? "insufficient history"})`
            : `${formatPercent(behaviour.capture.up, 0)} / ${formatPercent(behaviour.capture.down, 0)}`}
        </p>
      </Section>

      <Section title="Cost against peers">
        {behaviour.cost.expense_ratio === null || behaviour.cost.category_median === null ? (
          <p>
            {behaviour.cost.expense_ratio === null
              ? "No expense ratio published for this scheme."
              : `Only ${pluralise(behaviour.cost.category_count, "peer")} publish an expense ratio.`}
          </p>
        ) : (
          <p>
            TER {formatPercent(behaviour.cost.expense_ratio, 2)} vs sub-category median{" "}
            {formatPercent(behaviour.cost.category_median, 2)} (
            {pluralise(behaviour.cost.category_count, "fund")}); fee gap over{" "}
            {behaviour.cost.horizon_years} years{" "}
            {behaviour.cost.shortfall_vs_median === null
              ? DASH
              : formatPercent(behaviour.cost.shortfall_vs_median, 2)}
            .
          </p>
        )}
      </Section>

      <Section title="Estimated style exposure">
        {exposure.weights.length === 0 ? (
          <p>
            No exposure can be estimated:{" "}
            {(exposure.reason && metrics.missing_reason_descriptions[exposure.reason]) ??
              exposure.reason ??
              "not enough history"}
          </p>
        ) : (
          <p>
            {exposure.weights
              .map((w) => `${w.benchmark_name} ${formatPercent(w.weight, 0)}`)
              .join(", ")}{" "}
            &middot; fit R-squared{" "}
            {exposure.r_squared === null ? DASH : exposure.r_squared.toFixed(2)} over{" "}
            {exposure.months} months. 3Y style drift:{" "}
            {drift.value === null ? DASH : formatPercent(drift.value, 1)}.
          </p>
        )}
      </Section>

      {missingByReason.length ? (
        <Section title="Why a number is missing">
          <ul>
            {missingByReason.map(([reason, fields]) => (
              <li key={reason}>
                {metrics.missing_reason_descriptions[reason] ?? reason}: {fields.join(", ")}
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      <footer className="border-t border-black/20 pt-1">
        <p>
          Methodology v{metrics.methodology_version}, as of {metrics.as_of_date}.
        </p>
        <p>{disclaimer}</p>
      </footer>
    </div>
  );
}
