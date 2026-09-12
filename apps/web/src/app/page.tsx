import { formatPercent } from "@mf/shared";
import Link from "next/link";
import { Card, Stat } from "@/components/ui";
import { getBenchmarks, getCategories, getMetadata, getPresets } from "@/lib/api";

export const dynamic = "force-dynamic";

const QUICK_LINKS = [
  { label: "Mid Cap", sub: "Mid Cap Fund" },
  { label: "Small Cap", sub: "Small Cap Fund" },
  { label: "Flexi Cap", sub: "Flexi Cap Fund" },
  { label: "Large Cap", sub: "Large Cap Fund" },
  { label: "Value", sub: "Value Fund" },
  { label: "Multi Cap", sub: "Multi Cap Fund" },
  { label: "Index Funds", sub: "Index Funds" },
];

export default async function DashboardPage() {
  const [metadata, presets, categories, benchmarks] = await Promise.all([
    getMetadata(),
    getPresets(),
    getCategories(),
    getBenchmarks(),
  ]);
  const foreignBenchmarks = benchmarks.benchmarks.filter((b) => !b.comparable_with_inr_funds);
  const available = new Set(
    categories.items.map((item) => item.clean_sub_category ?? "").filter(Boolean),
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Indian mutual fund screener</h1>
        <p className="mt-1 max-w-3xl text-sm text-ink-500">
          Every number here is computed locally from stored AMFI NAV snapshots, with the peer
          universe and the missing-data policy stated up front. Nothing on this page is a
          recommendation.
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

      <Card title="Jump to a sub-category">
        <div className="flex flex-wrap gap-2">
          {QUICK_LINKS.filter((link) => available.has(link.sub)).map((link) => (
            <Link
              key={link.sub}
              href={`/screener?sub_category=${encodeURIComponent(link.sub)}`}
              className="rounded-md border border-ink-300 px-3 py-1.5 text-sm hover:bg-ink-100"
            >
              {link.label}
            </Link>
          ))}
          <Link
            href="/screener?search=s%26p+500"
            className="rounded-md border border-ink-300 px-3 py-1.5 text-sm hover:bg-ink-100"
          >
            S&amp;P 500 / overseas
          </Link>
        </div>
        {QUICK_LINKS.some((link) => !available.has(link.sub)) ? (
          <p className="mt-3 text-xs text-ink-500">
            Sub-categories missing from this list are not present in the loaded dataset. The sample
            dataset covers only a handful of them; run <code>make data-build</code> for the full
            universe.
          </p>
        ) : null}
      </Card>

      <Card title="Preset screens" subtitle="Starting points you can edit. Not recommendations.">
        <ul className="grid gap-3 md:grid-cols-2">
          {presets.map((preset) => (
            <li key={preset.id} className="rounded-md border border-ink-200 p-3">
              <Link
                href={`/screener?preset=${preset.id}`}
                className="text-sm font-medium text-accent-600 hover:underline"
              >
                {preset.name}
              </Link>
              <p className="mt-1 text-xs text-ink-500">{preset.description}</p>
            </li>
          ))}
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
        <p className="mt-3 text-xs text-ink-500">
          Risk-free rate in use: {formatPercent(0.065)} annual by default, configurable with
          MF_RISK_FREE_ANNUAL. See the methodology page for the exact conversion.
        </p>
      </Card>
    </div>
  );
}
