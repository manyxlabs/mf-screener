import { formatPercent } from "@mf/shared";
import Link from "next/link";
import { Formula } from "@/components/formula";
import { Card } from "@/components/ui";
import { getMetadata, getMethodology } from "@/lib/api";

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
  sip_xirr: "SIP return (XIRR)",
  basket_correlation: "Basket correlation",
  basket_blended_return: "Basket blended return",
  diversification_benefit: "Diversification benefit",
  capture_ratio: "Up and down capture",
  worst_calendar_year_return: "Worst calendar-year return",
  quartile_now: "Current peer quartile",
  quartile_persistence_3y: "Quartile persistence over 3 years",
  style_exposure: "Style exposure",
  style_drift_3y: "Style drift over 3 years",
  aum_family_latest: "Latest fund-family AUM",
  aum_growth_4q: "AUM growth over 4 quarters",
  aum_percentile_in_sub_category: "AUM percentile in sub-category",
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

// Where the glossary's "How this is computed" links land, for the concepts whose
// computation is one formula rather than a whole section.
const FORMULA_ANCHORS: Record<string, string> = {
  rolling_cagr: "rolling",
  volatility: "risk",
  max_drawdown: "drawdown",
  sip_xirr: "sip-xirr",
};

const SECTIONS = [
  ["frequency", "Frequency"],
  ["risk-free", "Risk-free rate"],
  ["formulas", "Formulas"],
  ["peer-universe", "Peer universe"],
  ["survivorship", "Survivorship bias"],
  ["minimums", "Minimum observations"],
  ["alpha-significance", "Alpha significance"],
  ["benchmarks", "Benchmarks"],
  ["data-quality", "Why a value is missing"],
  ["catalog", "Metric catalog"],
  ["sources", "Sources"],
  ["limitations", "Limitations"],
] as const;

const humanise = (key: string) => {
  const text = key.replaceAll("_", " ");
  return text.charAt(0).toUpperCase() + text.slice(1);
};

function show(value: unknown): string {
  if (value && typeof value === "object") {
    return Object.entries(value)
      .map(([k, v]) => `${k}: ${show(v)}`)
      .join(" · ");
  }
  return String(value);
}

/** A flat label/value list for the methodology document's plain objects. */
function KeyValues({ entries }: { entries: Record<string, unknown> }) {
  return (
    <dl className="divide-y divide-ink-100 text-sm">
      {Object.entries(entries).map(([key, value]) => (
        <div
          key={key}
          className="grid gap-1 py-2.5 first:pt-0 last:pb-0 sm:grid-cols-[14rem_1fr] sm:gap-4"
        >
          <dt className="font-medium text-ink-900">{humanise(key)}</dt>
          <dd className="text-ink-700">{show(value)}</dd>
        </div>
      ))}
    </dl>
  );
}

// Reason codes and metric names are single long words that would widen a phone page.
const code = "rounded bg-ink-100 px-1.5 py-0.5 font-mono text-[0.8em] wrap-anywhere";

export default async function MethodologyPage() {
  const [methodology, metadata] = await Promise.all([getMethodology(), getMetadata()]);
  const alphaSignificance = (methodology as unknown as { alpha_significance: AlphaSignificance })
    .alpha_significance;

  return (
    <div className="space-y-8">
      <header className="max-w-3xl space-y-3">
        <h1 className="text-3xl font-semibold tracking-tight">Methodology</h1>
        <p className="text-base text-ink-500">
          The exact statement of how each number is computed, and when it is refused rather than
          computed. New to these terms? Start with the{" "}
          <Link className="text-accent-600 hover:underline" href="/glossary">
            glossary
          </Link>
          , which says what each number means in plain language.
        </p>
        <p className="flex flex-wrap gap-1.5 text-xs">
          {[
            `Version ${methodology.version}`,
            `Metrics as of ${metadata.coverage.metrics_as_of ?? "-"}`,
            `NAV ${metadata.coverage.first_nav_date ?? "-"} to ${metadata.coverage.last_nav_date ?? "-"}`,
          ].map((item) => (
            <span
              key={item}
              className="rounded-full border border-ink-200 bg-surface px-2.5 py-1 text-ink-700"
            >
              {item}
            </span>
          ))}
        </p>
        <p className="text-xs text-ink-500">{methodology.disclaimer}</p>
      </header>

      <div className="grid gap-8 lg:grid-cols-[14rem_1fr]">
        <nav
          aria-label="Methodology sections"
          className="hidden text-sm lg:sticky lg:top-24 lg:block lg:self-start"
        >
          {SECTIONS.map(([id, label]) => (
            <a
              key={id}
              href={`#${id}`}
              className="block rounded-lg px-3 py-1.5 text-ink-700 hover:bg-ink-900/5 hover:text-ink-900"
            >
              {label}
            </a>
          ))}
        </nav>

        <div className="min-w-0 space-y-5">
          <Card id="frequency" title="Observation frequency and annualisation">
            <KeyValues entries={methodology.frequency} />
            <p className="mt-4 rounded-lg bg-ink-100 p-3 text-sm text-ink-700">
              {methodology.month_end_rule}
            </p>
          </Card>

          <Card id="risk-free" title="Risk-free rate">
            <p className="text-sm leading-relaxed text-ink-700">
              {formatPercent(methodology.risk_free_rate.annual)} a year, converted geometrically to{" "}
              {formatPercent(methodology.risk_free_rate.monthly, 4)} a month with{" "}
              <code className={code}>{methodology.risk_free_rate.conversion}</code>. A naive
              division by twelve would overstate the monthly hurdle. Change it with{" "}
              <code className={code}>{methodology.risk_free_rate.configurable_via}</code>.
            </p>
          </Card>

          <Card id="formulas" title="Formulas">
            <div className="grid gap-3 xl:grid-cols-2">
              {Object.entries(methodology.formulas).map(([key, tex]) => (
                <div
                  key={key}
                  id={FORMULA_ANCHORS[key]}
                  className="min-w-0 rounded-xl border border-ink-200 p-4 target:border-accent-500 target:ring-3 target:ring-accent-500/15"
                >
                  <h3 className="text-sm font-semibold text-ink-900">
                    {FORMULA_LABELS[key] ?? humanise(key)}
                  </h3>
                  <div className="mt-2 overflow-x-auto">
                    <Formula tex={tex} />
                  </div>
                  {methodology.formula_notes[key] ? (
                    <p className="mt-2 text-xs leading-relaxed text-ink-500">
                      {methodology.formula_notes[key]}
                    </p>
                  ) : null}
                </div>
              ))}
            </div>
            <p className="mt-4 text-xs text-ink-500">
              Standard deviations use the sample estimator (ddof = 1). Monthly statistics are
              annualised by sqrt(12); no metric mixes daily and monthly observations.
            </p>
          </Card>

          <Card id="peer-universe" title="Peer universe">
            <ul className="list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-ink-700">
              {methodology.peer_universe_rules.map((rule) => (
                <li key={rule}>{rule}</li>
              ))}
            </ul>
            <h3 className="mt-5 mb-2 text-sm font-semibold text-ink-900">Defaults</h3>
            <KeyValues entries={methodology.peer_universe_default} />
          </Card>

          <Card id="survivorship" title="Survivorship bias, quantified">
            <p className="text-sm leading-relaxed text-ink-700">
              Every category aggregate (CAGR at 1, 3, 5 and 10 years) is computed twice: once over
              today&apos;s active schemes only, and once over every scheme in the category including
              ones that later closed or merged away. A category_key encodes which side it is with an{" "}
              <code className={code}>active=y</code> or <code className={code}>active=n</code>{" "}
              marker; the two keys for one category differ only in that marker.
            </p>
            <p className="mt-3 text-sm leading-relaxed text-ink-700">
              <code className={code}>GET /categories/&#123;category_key&#125;/metrics</code> returns
              both sides as <code className={code}>active_only</code> and{" "}
              <code className={code}>all_schemes</code>, plus{" "}
              <code className={code}>survivorship_gap_pp</code>: the active-only CAGR minus the
              all-schemes CAGR at each horizon, in percentage points. A positive gap means the
              active-only average - the default shown everywhere else in this app - overstates the
              category by leaving out the funds that did not survive.
            </p>
          </Card>

          <Card id="minimums" title="Minimum observations before a metric is computed">
            <KeyValues entries={methodology.minimum_observations} />
            <p className="mt-4 rounded-lg bg-ink-100 p-3 text-sm text-ink-700">
              Below these thresholds the metric is null with a stated reason. Nothing is
              extrapolated, and NAV gaps are never forward-filled to manufacture an observation.
            </p>
          </Card>

          <Card id="alpha-significance" title="Alpha significance and multiple comparisons">
            <div className="space-y-3 text-sm leading-relaxed text-ink-700">
              <p>{alphaSignificance.problem}</p>
              <p>{alphaSignificance.no_correction_applied}</p>
              <p className="rounded-lg border-l-2 border-warn-300 bg-warn-50 p-3 font-medium text-warn-900">
                {alphaSignificance.expected_false_positives_at_p05}
              </p>
              <p>{alphaSignificance.how_to_read_it}</p>
            </div>
          </Card>

          <Card id="benchmarks" title="Benchmarks">
            <KeyValues entries={methodology.benchmarks} />
            <h3 className="mt-5 mb-2 text-sm font-semibold text-ink-900">Loaded series</h3>
            {metadata.benchmarks.length ? (
              <ul className="divide-y divide-ink-100 text-sm">
                {metadata.benchmarks.map((b) => (
                  <li
                    key={b.benchmark_id}
                    className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2"
                  >
                    <span className="font-medium text-ink-900">{b.benchmark_name}</span>
                    <span className="text-ink-500">
                      {b.currency} · {b.months} months
                    </span>
                    <code className={`${code} text-ink-500`}>{b.source}</code>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-ink-700">None loaded.</p>
            )}
          </Card>

          <Card id="data-quality" title="Why a value can be missing">
            <p className="mb-4 text-sm text-ink-500">
              Every blank on this site carries one of these reasons; click a blank to see which.
            </p>
            <dl className="grid gap-3 xl:grid-cols-2">
              {Object.entries(methodology.data_quality_reasons).map(([reason, description]) => (
                <div key={reason} className="rounded-xl border border-ink-200 p-4">
                  <dt>
                    <code className={`${code} text-ink-700`}>{reason}</code>
                  </dt>
                  <dd className="mt-2 text-sm leading-relaxed text-ink-700">{description}</dd>
                </div>
              ))}
            </dl>
          </Card>

          <Card id="catalog" title="Metric catalog">
            <div className="scroll-x overflow-x-auto">
              <table className="w-full min-w-[48rem] text-sm">
                <thead className="text-left text-xs text-ink-500">
                  <tr className="[&_th]:pr-4 [&_th]:pb-2 [&_th]:font-medium">
                    <th>Metric</th>
                    <th>Definition</th>
                    <th>Better</th>
                    <th>Caveat</th>
                  </tr>
                </thead>
                <tbody>
                  {methodology.metric_catalog.map((metric) => (
                    <tr
                      key={metric.name}
                      className="border-t border-ink-100 align-top [&_td]:py-2.5 [&_td]:pr-4"
                    >
                      <td>
                        <Link
                          href={`/glossary#metric-${metric.name}`}
                          className="font-medium text-ink-900 hover:text-accent-600 hover:underline"
                        >
                          {metric.plain_label || metric.label}
                        </Link>
                        <div className="mt-0.5 font-mono text-[11px] text-ink-500">
                          {metric.name}
                        </div>
                      </td>
                      <td className="text-ink-700">{metric.definition}</td>
                      <td className="whitespace-nowrap text-ink-700">
                        {metric.direction === "higher_is_better"
                          ? "Higher"
                          : metric.direction === "lower_is_better"
                            ? "Lower"
                            : "Neither"}
                      </td>
                      <td className="text-ink-500">{metric.caveat}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <Card id="sources" title="Sources and attribution">
            <KeyValues entries={methodology.sources} />
          </Card>

          <Card id="limitations" title="Limitations">
            <ul className="list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-ink-700">
              {methodology.limitations.map((item) => (
                <li key={item}>{item}</li>
              ))}
              <li>
                Survivorship bias: this site publishes today&apos;s active schemes only, so
                historical screening here will not see funds that closed or merged. The API (
                <code className={code}>make api</code>) keeps them, and &quot;Survivorship bias,
                quantified&quot; above shows how it measures the gap per category.
              </li>
            </ul>
          </Card>
        </div>
      </div>
    </div>
  );
}
