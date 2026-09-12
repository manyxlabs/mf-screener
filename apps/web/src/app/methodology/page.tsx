import { formatPercent } from "@mf/shared";
import { Formula } from "@/components/formula";
import { Card } from "@/components/ui";
import { getMetadata, getMethodology } from "@/lib/api";

export const dynamic = "force-dynamic";

const FORMULA_LABELS: Record<string, string> = {
  trailing_cagr: "Trailing CAGR over horizon h",
  rolling_cagr: "Rolling CAGR of the window ending at t",
  sharpe: "Sharpe ratio",
  sortino: "Sortino ratio",
  downside_deviation: "Downside deviation",
  volatility: "Annualised volatility",
  tracking_error: "Tracking error",
  information_ratio: "Information ratio",
  alpha_beta: "Alpha and beta regression",
  alpha_tstat: "Alpha t-statistic",
  alpha_pvalue: "Alpha p-value",
  max_drawdown: "Maximum drawdown",
  calmar: "Calmar ratio",
  peer_excess: "Excess return over peers",
  peer_ratio: "Ratio to peers",
};

// T1.7's addition to the API's methodology document. The shared zod schema
// (@mf/shared) passes it through at runtime but does not type it yet, so this
// is a local, narrow cast rather than a change to that generated-looking type.
type AlphaSignificance = {
  problem: string;
  no_correction_applied: string;
  expected_false_positives_at_p05: string;
  how_to_read_it: string;
};

export default async function MethodologyPage() {
  const [methodology, metadata] = await Promise.all([getMethodology(), getMetadata()]);
  const alphaSignificance = (methodology as unknown as { alpha_significance: AlphaSignificance })
    .alpha_significance;

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">Methodology</h1>
        <p className="mt-1 max-w-3xl text-sm text-ink-500">{methodology.disclaimer}</p>
        <p className="mt-1 text-xs text-ink-500">
          Version {methodology.version} · metrics computed as of{" "}
          {metadata.coverage.metrics_as_of ?? "-"} · NAV coverage{" "}
          {metadata.coverage.first_nav_date ?? "-"} to {metadata.coverage.last_nav_date ?? "-"}
        </p>
      </header>

      <Card title="Observation frequency and annualisation">
        <ul className="space-y-1 text-sm text-ink-700">
          {Object.entries(methodology.frequency).map(([key, value]) => (
            <li key={key}>
              <span className="font-medium">{key.replaceAll("_", " ")}:</span> {value}
            </li>
          ))}
        </ul>
        <p className="mt-3 text-sm text-ink-700">{methodology.month_end_rule}</p>
      </Card>

      <Card title="Risk-free rate">
        <p className="text-sm text-ink-700">
          {formatPercent(methodology.risk_free_rate.annual)} a year, converted geometrically to{" "}
          {formatPercent(methodology.risk_free_rate.monthly, 4)} a month with{" "}
          <code className="rounded bg-ink-100 px-1">{methodology.risk_free_rate.conversion}</code>.
          A naive division by twelve would overstate the monthly hurdle. Change it with{" "}
          <code className="rounded bg-ink-100 px-1">
            {methodology.risk_free_rate.configurable_via}
          </code>
          .
        </p>
      </Card>

      <Card title="Formulas">
        <div className="grid gap-4 lg:grid-cols-2">
          {Object.entries(methodology.formulas).map(([key, tex]) => (
            <div key={key} className="rounded-md border border-ink-200 p-3">
              <h3 className="text-sm font-medium">{FORMULA_LABELS[key] ?? key}</h3>
              <Formula tex={tex} />
              {methodology.formula_notes[key] ? (
                <p className="mt-1 text-xs text-ink-500">{methodology.formula_notes[key]}</p>
              ) : null}
            </div>
          ))}
        </div>
        <p className="mt-3 text-xs text-ink-500">
          Standard deviations use the sample estimator (ddof = 1). Monthly statistics are annualised
          by sqrt(12); no metric mixes daily and monthly observations.
        </p>
      </Card>

      <Card title="Peer universe">
        <ul className="list-disc space-y-1 pl-5 text-sm text-ink-700">
          {methodology.peer_universe_rules.map((rule) => (
            <li key={rule}>{rule}</li>
          ))}
        </ul>
        <pre className="mt-3 overflow-x-auto rounded bg-ink-50 p-3 text-xs">
          {JSON.stringify(methodology.peer_universe_default, null, 2)}
        </pre>
      </Card>

      <Card title="Survivorship bias, quantified">
        <p className="text-sm text-ink-700">
          Every category aggregate (CAGR at 1, 3, 5 and 10 years) is computed twice: once over
          today&apos;s active schemes only, and once over every scheme in the category including
          ones that later closed or merged away. A category_key encodes which side it is with an{" "}
          <code className="rounded bg-ink-100 px-1">active=y</code> or{" "}
          <code className="rounded bg-ink-100 px-1">active=n</code> marker; the two keys for one
          category differ only in that marker.
        </p>
        <p className="mt-2 text-sm text-ink-700">
          <code className="rounded bg-ink-100 px-1">
            GET /categories/&#123;category_key&#125;/metrics
          </code>{" "}
          returns both sides as <code className="rounded bg-ink-100 px-1">active_only</code> and{" "}
          <code className="rounded bg-ink-100 px-1">all_schemes</code>, plus{" "}
          <code className="rounded bg-ink-100 px-1">survivorship_gap_pp</code>: the active-only CAGR
          minus the all-schemes CAGR at each horizon, in percentage points. A positive gap means the
          active-only average - the default shown everywhere else in this app - overstates the
          category by leaving out the funds that did not survive.
        </p>
      </Card>

      <Card title="Minimum observations before a metric is computed">
        <pre className="overflow-x-auto rounded bg-ink-50 p-3 text-xs">
          {JSON.stringify(methodology.minimum_observations, null, 2)}
        </pre>
        <p className="mt-2 text-sm text-ink-700">
          Below these thresholds the metric is null with a stated reason. Nothing is extrapolated,
          and NAV gaps are never forward-filled to manufacture an observation.
        </p>
      </Card>

      <Card title="Alpha significance and multiple comparisons">
        <p className="text-sm text-ink-700">{alphaSignificance.problem}</p>
        <p className="mt-2 text-sm text-ink-700">{alphaSignificance.no_correction_applied}</p>
        <p className="mt-2 text-sm font-medium text-ink-900">
          {alphaSignificance.expected_false_positives_at_p05}
        </p>
        <p className="mt-2 text-sm text-ink-700">{alphaSignificance.how_to_read_it}</p>
      </Card>

      <Card title="Benchmarks">
        <ul className="space-y-2 text-sm text-ink-700">
          {Object.entries(methodology.benchmarks).map(([key, value]) => (
            <li key={key}>
              <span className="font-medium">{key.replaceAll("_", " ")}:</span> {value}
            </li>
          ))}
        </ul>
        <h3 className="mt-4 text-xs font-semibold uppercase tracking-wide text-ink-500">
          Loaded series
        </h3>
        {metadata.benchmarks.length ? (
          <ul className="mt-1 space-y-1 text-sm">
            {metadata.benchmarks.map((b) => (
              <li key={b.benchmark_id}>
                {b.benchmark_name} ({b.currency}) · {b.months} months · source{" "}
                <code className="rounded bg-ink-100 px-1 text-xs">{b.source}</code>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-1 text-sm text-ink-700">None loaded.</p>
        )}
      </Card>

      <Card title="Why a value can be missing">
        <dl className="space-y-2 text-sm">
          {Object.entries(methodology.data_quality_reasons).map(([reason, description]) => (
            <div key={reason}>
              <dt className="font-mono text-xs text-ink-700">{reason}</dt>
              <dd className="text-ink-700">{description}</dd>
            </div>
          ))}
        </dl>
      </Card>

      <Card title="Metric catalog">
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase tracking-wide text-ink-500">
            <tr>
              <th className="py-1">Metric</th>
              <th>Definition</th>
              <th>Direction</th>
              <th>Caveat</th>
            </tr>
          </thead>
          <tbody>
            {methodology.metric_catalog.map((metric) => (
              <tr key={metric.name} className="border-t border-ink-100 align-top">
                <td className="py-1.5 pr-3">
                  <div>{metric.label}</div>
                  <div className="font-mono text-[11px] text-ink-500">{metric.name}</div>
                </td>
                <td className="pr-3">{metric.definition}</td>
                <td className="pr-3 whitespace-nowrap">{metric.direction.replaceAll("_", " ")}</td>
                <td className="text-ink-500">{metric.caveat}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Card title="Sources and attribution">
        <ul className="space-y-1 text-sm text-ink-700">
          {Object.entries(methodology.sources).map(([key, value]) => (
            <li key={key}>
              <span className="font-medium">{key.replaceAll("_", " ")}:</span> {value}
            </li>
          ))}
        </ul>
      </Card>

      <Card title="Limitations">
        <ul className="list-disc space-y-1 pl-5 text-sm text-ink-700">
          {methodology.limitations.map((item) => (
            <li key={item}>{item}</li>
          ))}
          <li>
            Survivorship bias: the default universe is today&apos;s active schemes. Historical
            screening over it will not see funds that closed or merged. Turn off &quot;active
            only&quot; in the screener to include them, or see &quot;Survivorship bias,
            quantified&quot; above for the measured gap, per category, in percentage points.
          </li>
        </ul>
      </Card>
    </div>
  );
}
