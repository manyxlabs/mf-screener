import { formatPercent } from "@mf/shared";
import Link from "next/link";
import { Card, Stat } from "@/components/ui";
import { getBenchmarks, getMetadata } from "@/lib/api";
import { pageMetadata } from "@/lib/site";

export const metadata = pageMetadata(
  "/data-status/",
  "Data status",
  "What the screener has loaded from AMFI: funds and NAV rows, NAV coverage dates, when metrics were last rebuilt and the default screening universe.",
);

/**
 * What the landing page used to open on: dataset counts, the default peer universe,
 * benchmark coverage and the ingest log. All of it is a question about the store
 * rather than about a fund, so it belongs one click away from a first visit rather
 * than in front of it. Nothing here was reworded on the way over.
 */
export default async function DataStatusPage() {
  const [metadata, benchmarks] = await Promise.all([getMetadata(), getBenchmarks()]);
  const foreignBenchmarks = benchmarks.benchmarks.filter((b) => !b.comparable_with_inr_funds);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Data status</h1>
        <p className="mt-1 max-w-3xl text-sm text-ink-500">
          What is loaded, how far it reaches, and when it was last rebuilt.
        </p>
      </div>

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat
          label="Funds loaded"
          value={(metadata.counts["fund_families"] ?? 0).toLocaleString("en-IN")}
          hint={`${(metadata.counts["scheme_master"] ?? 0).toLocaleString("en-IN")} scheme codes`}
          tooltip="Direct and Regular, Growth and IDCW are separate scheme codes for one economic fund. This counts the funds; the scheme code count is what AMFI publishes, and it is larger."
        />
        <Stat
          label="Daily NAV rows"
          value={(metadata.counts["nav_daily"] ?? 0).toLocaleString("en-IN")}
        />
        <Stat
          label="NAV coverage"
          value={metadata.coverage.first_nav_date ?? "-"}
          hint={`to ${metadata.coverage.last_nav_date ?? "-"}`}
        />
        <Stat
          label="Metrics as of"
          value={metadata.coverage.metrics_as_of ?? "-"}
          hint={`methodology v${metadata.methodology_version}`}
        />
        <Stat
          label="Benchmarks loaded"
          value={metadata.benchmarks.length}
          hint={metadata.benchmarks.length ? "see coverage below" : "import a TRI CSV"}
        />
      </section>

      <Card
        title="Default screening universe"
        subtitle="Change any of this in the screener's filter drawer."
      >
        <ul className="grid gap-1 text-sm text-ink-700 sm:grid-cols-2">
          <li>Plan scope: {metadata.default_universe.plan_scope.replace("_", " + ")}</li>
          <li>Option scope: {metadata.default_universe.option_scope}</li>
          <li>Active schemes only: {metadata.default_universe.active_only ? "yes" : "no"}</li>
          <li>
            Peer average: {metadata.default_universe.aggregation}, leave-one-out{" "}
            {metadata.default_universe.exclude_self ? "on" : "off"}, minimum{" "}
            {metadata.default_universe.min_peers} peers
          </li>
        </ul>
      </Card>

      <Card
        title="Benchmark coverage"
        subtitle="Benchmark-relative metrics are only computed where a comparable series is loaded."
      >
        {benchmarks.benchmarks.length === 0 ? (
          <p className="text-sm text-ink-700">
            No benchmark series loaded. Alpha, beta, tracking error and the benchmark information
            ratio will all read &quot;-&quot; until you import one with{" "}
            <code className="rounded bg-ink-100 px-1">make benchmark-import FILE=...</code>.
          </p>
        ) : (
          <div className="space-y-2 text-sm text-ink-700">
            <p>
              {benchmarks.benchmarks.length} series loaded, covering{" "}
              {benchmarks.schemes_mapped.toLocaleString("en-IN")} of{" "}
              {benchmarks.schemes_total.toLocaleString("en-IN")} schemes.{" "}
              {benchmarks.schemes_unmapped.toLocaleString("en-IN")} have no benchmark mapped.
            </p>
            {foreignBenchmarks.length ? (
              <p className="rounded border border-bad-300 bg-bad-50 px-3 py-2 text-xs text-bad-900">
                <span aria-hidden="true">⚠ </span>
                {foreignBenchmarks.map((b) => b.benchmark_id).join(", ")}{" "}
                {foreignBenchmarks.length === 1 ? "is" : "are"} not quoted in{" "}
                {benchmarks.fund_currency}. No benchmark-relative metric is computed against{" "}
                {foreignBenchmarks.length === 1 ? "it" : "them"}: the difference would include the
                exchange rate.
              </p>
            ) : null}
            <p>
              <Link href="/benchmarks" className="underline">
                Benchmarks and mapping rules
              </Link>
            </p>
          </div>
        )}
      </Card>

      <Card title="Last pipeline runs">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-ink-500">
              <tr>
                <th className="py-1">Step</th>
                <th>Status</th>
                <th>Rows</th>
                <th>Finished</th>
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
        <p className="mt-3 text-xs text-ink-500">
          Risk-free rate in use: {formatPercent(0.065)} annual by default, configurable with
          MF_RISK_FREE_ANNUAL. See the methodology page for the exact conversion.
        </p>
      </Card>
    </div>
  );
}
