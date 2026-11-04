import Link from "next/link";

import { getBenchmarks } from "@/lib/api";
import { Badge, Card } from "@/components/ui";
import { pageMetadata } from "@/lib/site";

/**
 * A benchmark whose currency differs from the fund's is shown, never hidden, but it is
 * never shown as usable either: the row states that no benchmark-relative metric is
 * computed from it and why. Hiding it would leave a mapped scheme's blank alpha
 * unexplained; showing it plainly is what makes the FX gap impossible to misread.
 */
function CurrencyCell({
  currency,
  comparable,
  fundCurrency,
}: {
  currency: string;
  comparable: boolean;
  fundCurrency: string;
}) {
  if (comparable) return <span>{currency}</span>;
  return (
    <span className="whitespace-nowrap">
      <Badge tone="bad">{currency}</Badge>
      <span className="ml-1.5 text-[11px] text-bad-800">not comparable with {fundCurrency}</span>
    </span>
  );
}

export const metadata = pageMetadata(
  "/benchmarks/",
  "Benchmark coverage",
  "Which index each Indian mutual fund is measured against, where each series came from, which are index-fund proxies and what the benchmark mapping does not cover.",
);

export default async function BenchmarksPage() {
  const data = await getBenchmarks();
  const foreign = data.benchmarks.filter((b) => !b.comparable_with_inr_funds);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-lg font-semibold tracking-tight">Benchmarks</h1>
        <p className="mt-1 max-w-3xl text-sm text-ink-700">
          Which index each fund is measured against, where that index came from, and what it does
          not cover. Alpha, beta, tracking error and the benchmark information ratio all come from
          the series listed here.
        </p>
      </header>

      {foreign.length ? (
        <div className="rounded-lg border border-bad-300 bg-bad-50 p-4">
          <h2 className="text-sm font-semibold text-bad-900">
            {foreign.length === 1
              ? "One loaded benchmark is not in " + data.fund_currency
              : `${foreign.length} loaded benchmarks are not in ${data.fund_currency}`}
          </h2>
          <p className="mt-1 max-w-3xl text-sm text-bad-900">{data.currency_policy}</p>
          <ul className="mt-2 space-y-0.5 text-sm text-bad-900">
            {foreign.map((b) => (
              <li key={b.benchmark_id}>
                <span className="font-medium">{b.benchmark_id}</span> ({b.currency}) ·{" "}
                {b.mapped_schemes} scheme{b.mapped_schemes === 1 ? "" : "s"} mapped · no
                benchmark-relative metric is computed
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <div className="text-[11px] uppercase tracking-wide text-ink-500">Series loaded</div>
          <div className="mt-1 text-lg font-semibold numeric">{data.benchmarks.length}</div>
        </Card>
        <Card>
          <div className="text-[11px] uppercase tracking-wide text-ink-500">Schemes mapped</div>
          <div className="mt-1 text-lg font-semibold numeric">
            {data.schemes_mapped.toLocaleString("en-IN")}
          </div>
          <div className="mt-0.5 text-[11px] text-ink-500">
            of {data.schemes_total.toLocaleString("en-IN")}
          </div>
        </Card>
        <Card>
          <div className="text-[11px] uppercase tracking-wide text-ink-500">Schemes unmapped</div>
          <div className="mt-1 text-lg font-semibold numeric">
            {data.schemes_unmapped.toLocaleString("en-IN")}
          </div>
          <div className="mt-0.5 text-[11px] text-ink-500">
            benchmark metrics read &quot;-&quot;
          </div>
        </Card>
      </div>

      <Card
        title="Loaded series"
        subtitle="Everything a benchmark-relative metric can currently be computed from."
      >
        {data.benchmarks.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-ink-500">
                <tr>
                  <th className="py-1 pr-3">Benchmark</th>
                  <th className="pr-3">Currency</th>
                  <th className="pr-3">Coverage</th>
                  <th className="pr-4 text-right">Months</th>
                  <th className="pr-4 text-right">Schemes</th>
                  <th>Source</th>
                </tr>
              </thead>
              <tbody>
                {data.benchmarks.map((b) => (
                  <tr key={b.benchmark_id} className="border-t border-ink-100 align-top">
                    <td className="py-1.5 pr-3">
                      <div className="font-medium">{b.benchmark_name}</div>
                      <div className="font-mono text-[11px] text-ink-500">{b.benchmark_id}</div>
                      {b.is_proxy ? (
                        <div className="mt-1">
                          <Badge tone="warn">index-fund proxy</Badge>
                        </div>
                      ) : null}
                    </td>
                    <td className="pr-3">
                      <CurrencyCell
                        currency={b.currency}
                        comparable={b.comparable_with_inr_funds}
                        fundCurrency={data.fund_currency}
                      />
                    </td>
                    <td className="numeric pr-3 whitespace-nowrap">
                      {b.first_date} - {b.last_date}
                    </td>
                    <td className="numeric pr-4 text-right">{b.months}</td>
                    <td className="numeric pr-4 text-right">
                      {b.mapped_schemes.toLocaleString("en-IN")}
                    </td>
                    <td className="font-mono text-[11px] break-all text-ink-500">{b.source}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-ink-700">
            No benchmark series loaded. Alpha, beta, tracking error and the benchmark information
            ratio read &quot;-&quot; for every fund until you import one with{" "}
            <code className="rounded bg-ink-100 px-1">make benchmark-import FILE=...</code>.
          </p>
        )}
      </Card>

      {data.warnings.length ? (
        <Card title="Coverage warnings" subtitle="What the numbers on this site do not cover.">
          <ul className="list-disc space-y-1.5 pl-5 text-sm text-ink-700">
            {data.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </Card>
      ) : null}

      <Card
        title="Mapping rules"
        subtitle={`benchmark_map.yaml v${data.config_version ?? "?"} - the first rule a scheme matches wins.`}
      >
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-ink-500">
              <tr>
                <th className="py-1 pr-3">Matches</th>
                <th className="pr-3">Benchmark</th>
                <th className="pr-3">Fallbacks</th>
                <th>Note</th>
              </tr>
            </thead>
            <tbody>
              {data.mapping_rules.map((rule, index) => {
                const loaded = data.benchmarks.find((b) => b.benchmark_id === rule.benchmark_id);
                return (
                  <tr key={index} className="border-t border-ink-100 align-top">
                    <td className="py-1.5 pr-3">
                      {rule.sub_category_contains.map((m) => (
                        <span key={m} className="mr-1 inline-block">
                          <Badge>{m}</Badge>
                        </span>
                      ))}
                      {/* Whether these two groups are ANDed or ORed changes what the
                          rule claims entirely, so it is stated between them rather
                          than left for the reader to assume. */}
                      {rule.scheme_name_contains.length ? (
                        <span className="mr-1 text-[11px] font-semibold text-ink-500">
                          {rule.match === "all" ? "AND" : "OR"}
                        </span>
                      ) : null}
                      {rule.scheme_name_contains.map((m) => (
                        <span key={m} className="mr-1 inline-block">
                          <Badge>name: {m}</Badge>
                        </span>
                      ))}
                      {rule.scheme_name_excludes.map((m) => (
                        <span key={m} className="mr-1 inline-block">
                          <Badge tone="bad">not: {m}</Badge>
                        </span>
                      ))}
                    </td>
                    <td className="pr-3 font-mono text-[11px]">
                      {rule.benchmark_id}
                      {loaded ? null : <span className="ml-1 text-ink-500">(not loaded)</span>}
                    </td>
                    <td className="pr-3 font-mono text-[11px] text-ink-500">
                      {rule.fallback_benchmark_ids.join(", ") || "-"}
                    </td>
                    <td className="text-ink-500">{rule.notes ?? "-"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs text-ink-500">
          A series in {data.fund_currency} is always preferred over a foreign-currency one, wherever
          it sits in the fallback order. Edit{" "}
          <code className="rounded bg-ink-100 px-1">packages/analytics/benchmark_map.yaml</code> and
          re-run <code className="rounded bg-ink-100 px-1">make benchmark-map</code> to change any
          of this.
        </p>
      </Card>

      {data.unmapped_by_sub_category.length ? (
        <Card
          title="Unmapped sub-categories"
          subtitle="No rule matches these, so their benchmark-relative metrics are null."
        >
          <div className="flex flex-wrap gap-1.5">
            {data.unmapped_by_sub_category.map((row) => (
              <span key={row.clean_sub_category} className="text-xs">
                <Badge>
                  {row.clean_sub_category} · {row.schemes.toLocaleString("en-IN")}
                </Badge>
              </span>
            ))}
          </div>
        </Card>
      ) : null}

      <p className="text-xs text-ink-500">
        Method and formulas are on the{" "}
        <Link href="/methodology" className="underline">
          methodology page
        </Link>
        . {data.disclaimer}
      </p>
    </div>
  );
}
