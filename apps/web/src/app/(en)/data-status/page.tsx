import { formatPercent } from "@mf/shared";
import Link from "@/components/link";
import { Card, Stat } from "@/components/ui";
import { getBenchmarks, getMetadata } from "@/lib/api";
import { routeI18n, type LocaleParams } from "@/lib/i18n/server";
import { pageMetadata } from "@/lib/site";

export async function generateMetadata({ params }: LocaleParams) {
  const i18n = await routeI18n(params);
  return pageMetadata(
    i18n,
    "/data-status/",
    i18n.t.footer.dataStatus,
    i18n.t.dataStatus.metaDescription,
  );
}

/**
 * What the landing page used to open on: dataset counts, the default peer universe,
 * benchmark coverage and the ingest log. All of it is a question about the store
 * rather than about a fund, so it belongs one click away from a first visit rather
 * than in front of it. Nothing here was reworded on the way over.
 */
export default async function DataStatusPage({ params }: LocaleParams) {
  const [{ t, number }, metadata, benchmarks] = await Promise.all([
    routeI18n(params),
    getMetadata(),
    getBenchmarks(),
  ]);
  const copy = t.dataStatus;
  const universe = metadata.default_universe;
  const foreignBenchmarks = benchmarks.benchmarks.filter((b) => !b.comparable_with_inr_funds);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{t.footer.dataStatus}</h1>
        <p className="mt-1 max-w-3xl text-sm text-ink-500">{copy.lede}</p>
      </div>

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat
          label={copy.fundsLoaded}
          value={number(metadata.counts["fund_families"] ?? 0)}
          hint={copy.schemeCodes(number(metadata.counts["scheme_master"] ?? 0))}
          tooltip={copy.fundsTooltip}
        />
        <Stat label={copy.navRows} value={number(metadata.counts["nav_daily"] ?? 0)} />
        <Stat
          label={copy.navCoverage}
          value={metadata.coverage.first_nav_date ?? "-"}
          hint={copy.to(metadata.coverage.last_nav_date ?? "-")}
        />
        <Stat
          label={copy.metricsAsOf}
          value={metadata.coverage.metrics_as_of ?? "-"}
          hint={copy.methodologyVersion(metadata.methodology_version)}
        />
        <Stat
          label={copy.benchmarksLoaded}
          value={number(metadata.benchmarks.length)}
          hint={metadata.benchmarks.length ? copy.seeCoverage : copy.importTri}
        />
      </section>

      <Card title={copy.universeTitle} subtitle={copy.universeSubtitle}>
        <ul className="grid gap-1 text-sm text-ink-700 sm:grid-cols-2">
          <li>{copy.planScope(universe.plan_scope.replace("_", " + "))}</li>
          <li>{copy.optionScope(universe.option_scope)}</li>
          <li>{copy.activeOnly(universe.active_only)}</li>
          <li>
            {copy.peerAverage(universe.aggregation, universe.exclude_self, universe.min_peers)}
          </li>
        </ul>
      </Card>

      <Card title={copy.benchmarkTitle} subtitle={copy.benchmarkSubtitle}>
        {benchmarks.benchmarks.length === 0 ? (
          <p className="text-sm text-ink-700">
            {copy.noBenchmarks}
            <code className="rounded bg-ink-100 px-1">make benchmark-import FILE=...</code>
            {copy.noBenchmarksEnd}
          </p>
        ) : (
          <div className="space-y-2 text-sm text-ink-700">
            <p>
              {copy.coverage(
                number(benchmarks.benchmarks.length),
                number(benchmarks.schemes_mapped),
                number(benchmarks.schemes_total),
                number(benchmarks.schemes_unmapped),
              )}
            </p>
            {foreignBenchmarks.length ? (
              <p className="rounded border border-bad-300 bg-bad-50 px-3 py-2 text-xs text-bad-900">
                <span aria-hidden="true">⚠ </span>
                {copy.foreign(
                  foreignBenchmarks.length,
                  foreignBenchmarks.map((b) => b.benchmark_id).join(", "),
                  benchmarks.fund_currency,
                )}
              </p>
            ) : null}
            <p>
              <Link href="/benchmarks" className="underline">
                {copy.benchmarksLink}
              </Link>
            </p>
          </div>
        )}
      </Card>

      <Card title={copy.runsTitle}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-ink-500">
              <tr>
                <th className="py-1">{copy.runColumns.step}</th>
                <th>{copy.runColumns.status}</th>
                <th>{copy.runColumns.rows}</th>
                <th>{copy.runColumns.finished}</th>
              </tr>
            </thead>
            <tbody>
              {metadata.ingest_log.slice(0, 8).map((entry, index) => (
                <tr key={`${String(entry["run_id"])}-${index}`} className="border-t border-ink-100">
                  <td className="py-1.5">{String(entry["step"])}</td>
                  <td>{String(entry["status"])}</td>
                  <td className="numeric">{String(entry["row_count"] ?? "-")}</td>
                  <td className="numeric">{String(entry["finished_at"] ?? "-")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs text-ink-500">{copy.riskFree(formatPercent(0.065))}</p>
      </Card>
    </div>
  );
}
