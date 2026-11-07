import Link from "@/components/link";
import { Badge, Card } from "@/components/ui";
import { getBenchmarks } from "@/lib/api";
import { routeI18n, type LocaleParams } from "@/lib/i18n/server";
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
  notComparable,
}: {
  currency: string;
  comparable: boolean;
  notComparable: string;
}) {
  if (comparable) return <span>{currency}</span>;
  return (
    <span className="whitespace-nowrap">
      <Badge tone="bad">{currency}</Badge>
      <span className="ml-1.5 text-[11px] text-bad-800">{notComparable}</span>
    </span>
  );
}

export async function generateMetadata({ params }: LocaleParams) {
  const i18n = await routeI18n(params);
  return pageMetadata(
    i18n,
    "/benchmarks/",
    i18n.t.footer.benchmarks,
    i18n.t.benchmarks.metaDescription,
  );
}

export default async function BenchmarksPage({ params }: LocaleParams) {
  const [{ t, td, number }, data] = await Promise.all([routeI18n(params), getBenchmarks()]);
  const copy = t.benchmarks;
  const foreign = data.benchmarks.filter((b) => !b.comparable_with_inr_funds);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-lg font-semibold tracking-tight">{copy.title}</h1>
        <p className="mt-1 max-w-3xl text-sm text-ink-700">{copy.lede}</p>
      </header>

      {foreign.length ? (
        <div className="rounded-lg border border-bad-300 bg-bad-50 p-4">
          <h2 className="text-sm font-semibold text-bad-900">
            {copy.foreignHeading(foreign.length, number(foreign.length), data.fund_currency)}
          </h2>
          <p className="mt-1 max-w-3xl text-sm text-bad-900">{td(data.currency_policy)}</p>
          <ul className="mt-2 space-y-0.5 text-sm text-bad-900">
            {foreign.map((b) => (
              <li key={b.benchmark_id}>
                <span className="font-medium">{b.benchmark_id}</span> ({b.currency}) ·{" "}
                {copy.foreignMapped(b.mapped_schemes, number(b.mapped_schemes))}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <div className="text-[11px] uppercase tracking-wide text-ink-500">
            {copy.seriesLoaded}
          </div>
          <div className="mt-1 text-lg font-semibold numeric">{data.benchmarks.length}</div>
        </Card>
        <Card>
          <div className="text-[11px] uppercase tracking-wide text-ink-500">
            {copy.schemesMapped}
          </div>
          <div className="mt-1 text-lg font-semibold numeric">{number(data.schemes_mapped)}</div>
          <div className="mt-0.5 text-[11px] text-ink-500">
            {copy.of(number(data.schemes_total))}
          </div>
        </Card>
        <Card>
          <div className="text-[11px] uppercase tracking-wide text-ink-500">
            {copy.schemesUnmapped}
          </div>
          <div className="mt-1 text-lg font-semibold numeric">{number(data.schemes_unmapped)}</div>
          <div className="mt-0.5 text-[11px] text-ink-500">{copy.unmappedHint}</div>
        </Card>
      </div>

      <Card title={copy.loadedTitle} subtitle={copy.loadedSubtitle}>
        {data.benchmarks.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-ink-500">
                <tr>
                  <th className="py-1 pr-3">{copy.columns.benchmark}</th>
                  <th className="pr-3">{copy.columns.currency}</th>
                  <th className="pr-3">{copy.columns.coverage}</th>
                  <th className="pr-4 text-right">{copy.columns.months}</th>
                  <th className="pr-4 text-right">{copy.columns.schemes}</th>
                  <th>{copy.columns.source}</th>
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
                          <Badge tone="warn">{copy.proxy}</Badge>
                        </div>
                      ) : null}
                    </td>
                    <td className="pr-3">
                      <CurrencyCell
                        currency={b.currency}
                        comparable={b.comparable_with_inr_funds}
                        notComparable={copy.notComparable(data.fund_currency)}
                      />
                    </td>
                    <td className="numeric pr-3 whitespace-nowrap">
                      {b.first_date} - {b.last_date}
                    </td>
                    <td className="numeric pr-4 text-right">{number(b.months)}</td>
                    <td className="numeric pr-4 text-right">{number(b.mapped_schemes)}</td>
                    <td className="font-mono text-[11px] break-all text-ink-500">{b.source}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-ink-700">
            {copy.none}
            <code className="rounded bg-ink-100 px-1">make benchmark-import FILE=...</code>
            {copy.noneEnd}
          </p>
        )}
      </Card>

      {data.warnings.length ? (
        <Card title={copy.warningsTitle} subtitle={copy.warningsSubtitle}>
          <ul className="list-disc space-y-1.5 pl-5 text-sm text-ink-700">
            {data.warnings.map((warning) => (
              <li key={warning}>{td(warning)}</li>
            ))}
          </ul>
        </Card>
      ) : null}

      <Card
        title={copy.rulesTitle}
        subtitle={copy.rulesSubtitle(String(data.config_version ?? "?"))}
      >
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-ink-500">
              <tr>
                <th className="py-1 pr-3">{copy.ruleColumns.matches}</th>
                <th className="pr-3">{copy.ruleColumns.benchmark}</th>
                <th className="pr-3">{copy.ruleColumns.fallbacks}</th>
                <th>{copy.ruleColumns.note}</th>
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
                          {rule.match === "all" ? copy.and : copy.or}
                        </span>
                      ) : null}
                      {rule.scheme_name_contains.map((m) => (
                        <span key={m} className="mr-1 inline-block">
                          <Badge>{copy.nameContains(m)}</Badge>
                        </span>
                      ))}
                      {rule.scheme_name_excludes.map((m) => (
                        <span key={m} className="mr-1 inline-block">
                          <Badge tone="bad">{copy.nameExcludes(m)}</Badge>
                        </span>
                      ))}
                    </td>
                    <td className="pr-3 font-mono text-[11px]">
                      {rule.benchmark_id}
                      {loaded ? null : <span className="ml-1 text-ink-500">{copy.notLoaded}</span>}
                    </td>
                    <td className="pr-3 font-mono text-[11px] text-ink-500">
                      {rule.fallback_benchmark_ids.join(", ") || "-"}
                    </td>
                    <td className="text-ink-500">{rule.notes ? td(rule.notes) : "-"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs text-ink-500">
          {copy.preferred(data.fund_currency)}
          {copy.edit}
          <code className="rounded bg-ink-100 px-1">packages/analytics/benchmark_map.yaml</code>
          {copy.rerun}
          <code className="rounded bg-ink-100 px-1">make benchmark-map</code>
          {copy.toChange}
        </p>
      </Card>

      {data.unmapped_by_sub_category.length ? (
        <Card title={copy.unmappedTitle} subtitle={copy.unmappedSubtitle}>
          <div className="flex flex-wrap gap-1.5">
            {data.unmapped_by_sub_category.map((row) => (
              <span key={row.clean_sub_category} className="text-xs">
                <Badge>
                  {row.clean_sub_category} · {number(row.schemes)}
                </Badge>
              </span>
            ))}
          </div>
        </Card>
      ) : null}

      <p className="text-xs text-ink-500">
        {copy.methodBefore}
        <Link href="/methodology" className="underline">
          {copy.methodLink}
        </Link>
        {copy.methodAfter}
        {td(data.disclaimer)}
      </p>
    </div>
  );
}
