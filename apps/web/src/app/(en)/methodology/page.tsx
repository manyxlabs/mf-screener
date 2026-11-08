import { formatPercent } from "@mf/shared";
import { Fragment } from "react";
import { Formula } from "@/components/formula";
import Link from "@/components/link";
import { Card } from "@/components/ui";
import { getMetadata, getMethodology } from "@/lib/api";
import type { I18n } from "@/lib/i18n/core";
import { routeI18n, type LocaleParams } from "@/lib/i18n/server";
import { pageMetadata } from "@/lib/site";

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
  "frequency",
  "risk-free",
  "formulas",
  "peer-universe",
  "survivorship",
  "minimums",
  "alpha-significance",
  "benchmarks",
  "data-quality",
  "catalog",
  "sources",
  "limitations",
] as const;

const humanise = (key: string) => {
  const text = key.replaceAll("_", " ");
  return text.charAt(0).toUpperCase() + text.slice(1);
};

// Nested keys are horizon codes such as "3y", so they are shown as written.
function show(value: unknown, i18n: I18n): string {
  if (value && typeof value === "object") {
    return Object.entries(value)
      .map(([k, v]) => `${k}: ${show(v, i18n)}`)
      .join(" · ");
  }
  if (typeof value === "boolean") return value ? i18n.t.units.yes : i18n.t.units.no;
  return typeof value === "string" ? i18n.td(value) : String(value);
}

/** A flat label/value list for the methodology document's plain objects. */
function KeyValues({ entries, i18n }: { entries: Record<string, unknown>; i18n: I18n }) {
  return (
    <dl className="divide-y divide-ink-100 text-sm">
      {Object.entries(entries).map(([key, value]) => (
        <div
          key={key}
          className="grid gap-1 py-2.5 first:pt-0 last:pb-0 sm:grid-cols-[14rem_1fr] sm:gap-4"
        >
          <dt className="font-medium text-ink-900">{i18n.td(humanise(key))}</dt>
          <dd className="text-ink-700">{show(value, i18n)}</dd>
        </div>
      ))}
    </dl>
  );
}

// Reason codes and metric names are single long words that would widen a phone page.
const code = "rounded bg-ink-100 px-1.5 py-0.5 font-mono text-[0.8em] wrap-anywhere";

/** Text with an inline code at each gap between its pieces. */
function WithCode({ text, codes }: { text: string[]; codes: string[] }) {
  return text.map((piece, i) => (
    <Fragment key={i}>
      {piece}
      {i < codes.length ? <code className={code}>{codes[i]}</code> : null}
    </Fragment>
  ));
}

export async function generateMetadata({ params }: LocaleParams) {
  const i18n = await routeI18n(params);
  return pageMetadata(
    i18n,
    "/methodology/",
    i18n.t.methodology.metaTitle,
    i18n.t.methodology.metaDescription,
  );
}

export default async function MethodologyPage({ params }: LocaleParams) {
  const [i18n, methodology, metadata] = await Promise.all([
    routeI18n(params),
    getMethodology(),
    getMetadata(),
  ]);
  const { t, td, number } = i18n;
  const m = t.methodology;
  const formulaLabels: Partial<Record<string, string>> = m.formulas;
  const alphaSignificance = (methodology as unknown as { alpha_significance: AlphaSignificance })
    .alpha_significance;

  return (
    <div className="space-y-8">
      <header className="max-w-3xl space-y-3">
        <h1 className="text-3xl font-semibold tracking-tight">{m.title}</h1>
        <p className="text-base text-ink-500">
          {m.introBefore}
          <Link className="text-accent-600 hover:underline" href="/glossary">
            {m.introLink}
          </Link>
          {m.introAfter}
        </p>
        <p className="flex flex-wrap gap-1.5 text-xs">
          {[
            m.version(methodology.version),
            m.metricsAsOf(metadata.coverage.metrics_as_of ?? "-"),
            m.navRange(
              metadata.coverage.first_nav_date ?? "-",
              metadata.coverage.last_nav_date ?? "-",
            ),
          ].map((item) => (
            <span
              key={item}
              className="rounded-full border border-ink-200 bg-surface px-2.5 py-1 text-ink-700"
            >
              {item}
            </span>
          ))}
        </p>
        <p className="text-xs text-ink-500">{td(methodology.disclaimer)}</p>
      </header>

      <div className="grid gap-8 lg:grid-cols-[14rem_1fr]">
        <nav
          aria-label={m.sectionsLabel}
          className="hidden text-sm lg:sticky lg:top-24 lg:block lg:self-start"
        >
          {SECTIONS.map((id) => (
            <a
              key={id}
              href={`#${id}`}
              className="block rounded-lg px-3 py-1.5 text-ink-700 hover:bg-ink-900/5 hover:text-ink-900"
            >
              {m.sections[id]}
            </a>
          ))}
        </nav>

        <div className="min-w-0 space-y-5">
          <Card id="frequency" title={m.cards.frequency}>
            <KeyValues entries={methodology.frequency} i18n={i18n} />
            <p className="mt-4 rounded-lg bg-ink-100 p-3 text-sm text-ink-700">
              {td(methodology.month_end_rule)}
            </p>
          </Card>

          <Card id="risk-free" title={m.cards["risk-free"]}>
            <p className="text-sm leading-relaxed text-ink-700">
              <WithCode
                text={m.riskFree(
                  formatPercent(methodology.risk_free_rate.annual),
                  formatPercent(methodology.risk_free_rate.monthly, 4),
                )}
                codes={[
                  methodology.risk_free_rate.conversion,
                  methodology.risk_free_rate.configurable_via,
                ]}
              />
            </p>
          </Card>

          <Card id="formulas" title={m.cards.formulas}>
            <div className="grid gap-3 xl:grid-cols-2">
              {Object.entries(methodology.formulas).map(([key, tex]) => (
                <div
                  key={key}
                  id={FORMULA_ANCHORS[key]}
                  className="min-w-0 rounded-xl border border-ink-200 p-4 target:border-accent-500 target:ring-3 target:ring-accent-500/15"
                >
                  <h3 className="text-sm font-semibold text-ink-900">
                    {formulaLabels[key] ?? td(humanise(key))}
                  </h3>
                  <div className="mt-2 overflow-x-auto">
                    <Formula tex={tex} />
                  </div>
                  {methodology.formula_notes[key] ? (
                    <p className="mt-2 text-xs leading-relaxed text-ink-500">
                      {td(methodology.formula_notes[key])}
                    </p>
                  ) : null}
                </div>
              ))}
            </div>
            <p className="mt-4 text-xs text-ink-500">{m.formulasNote}</p>
          </Card>

          <Card id="peer-universe" title={m.cards["peer-universe"]}>
            <ul className="list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-ink-700">
              {methodology.peer_universe_rules.map((rule) => (
                <li key={rule}>{td(rule)}</li>
              ))}
            </ul>
            <h3 className="mt-5 mb-2 text-sm font-semibold text-ink-900">{m.defaults}</h3>
            <KeyValues entries={methodology.peer_universe_default} i18n={i18n} />
          </Card>

          <Card id="survivorship" title={m.cards.survivorship}>
            <p className="text-sm leading-relaxed text-ink-700">
              <WithCode text={m.survivorshipSides} codes={["active=y", "active=n"]} />
            </p>
            <p className="mt-3 text-sm leading-relaxed text-ink-700">
              <WithCode
                text={m.survivorshipGap}
                codes={[
                  "GET /categories/{category_key}/metrics",
                  "active_only",
                  "all_schemes",
                  "survivorship_gap_pp",
                ]}
              />
            </p>
          </Card>

          <Card id="minimums" title={m.cards.minimums}>
            <KeyValues entries={methodology.minimum_observations} i18n={i18n} />
            <p className="mt-4 rounded-lg bg-ink-100 p-3 text-sm text-ink-700">{m.minimumsNote}</p>
          </Card>

          <Card id="alpha-significance" title={m.cards["alpha-significance"]}>
            <div className="space-y-3 text-sm leading-relaxed text-ink-700">
              <p>{td(alphaSignificance.problem)}</p>
              <p>{td(alphaSignificance.no_correction_applied)}</p>
              <p className="rounded-lg border-l-2 border-warn-300 bg-warn-50 p-3 font-medium text-warn-900">
                {td(alphaSignificance.expected_false_positives_at_p05)}
              </p>
              <p>{td(alphaSignificance.how_to_read_it)}</p>
            </div>
          </Card>

          <Card id="benchmarks" title={m.cards.benchmarks}>
            <KeyValues entries={methodology.benchmarks} i18n={i18n} />
            <h3 className="mt-5 mb-2 text-sm font-semibold text-ink-900">{m.loadedSeries}</h3>
            {metadata.benchmarks.length ? (
              <ul className="divide-y divide-ink-100 text-sm">
                {metadata.benchmarks.map((b) => (
                  <li
                    key={b.benchmark_id}
                    className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2"
                  >
                    <span className="font-medium text-ink-900">{b.benchmark_name}</span>
                    <span className="text-ink-500">
                      {m.seriesMonths(b.currency, number(b.months))}
                    </span>
                    <code className={`${code} text-ink-500`}>{b.source}</code>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-ink-700">{m.noneLoaded}</p>
            )}
          </Card>

          <Card id="data-quality" title={m.cards["data-quality"]}>
            <p className="mb-4 text-sm text-ink-500">{m.reasonsIntro}</p>
            <dl className="grid gap-3 xl:grid-cols-2">
              {Object.entries(methodology.data_quality_reasons).map(([reason, description]) => (
                <div key={reason} className="rounded-xl border border-ink-200 p-4">
                  <dt>
                    <code className={`${code} text-ink-700`}>{reason}</code>
                  </dt>
                  <dd className="mt-2 text-sm leading-relaxed text-ink-700">{td(description)}</dd>
                </div>
              ))}
            </dl>
          </Card>

          <Card id="catalog" title={m.cards.catalog}>
            <div className="scroll-x overflow-x-auto">
              <table className="w-full min-w-[48rem] text-sm">
                <thead className="text-left text-xs text-ink-500">
                  <tr className="[&_th]:pr-4 [&_th]:pb-2 [&_th]:font-medium">
                    <th>{m.catalogColumns.metric}</th>
                    <th>{m.catalogColumns.definition}</th>
                    <th>{m.catalogColumns.better}</th>
                    <th>{m.catalogColumns.caveat}</th>
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
                          {td(metric.plain_label || metric.label)}
                        </Link>
                        <div className="mt-0.5 font-mono text-[11px] text-ink-500">
                          {metric.name}
                        </div>
                      </td>
                      <td className="text-ink-700">{td(metric.definition)}</td>
                      <td className="whitespace-nowrap text-ink-700">
                        {m.better[metric.direction]}
                      </td>
                      <td className="text-ink-500">{td(metric.caveat)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <Card id="sources" title={m.cards.sources}>
            <KeyValues entries={methodology.sources} i18n={i18n} />
          </Card>

          <Card id="limitations" title={m.cards.limitations}>
            <ul className="list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-ink-700">
              {methodology.limitations.map((item) => (
                <li key={item}>{td(item)}</li>
              ))}
              <li>
                <WithCode text={m.survivorshipLimitation} codes={["make api"]} />
              </li>
            </ul>
          </Card>
        </div>
      </div>
    </div>
  );
}
