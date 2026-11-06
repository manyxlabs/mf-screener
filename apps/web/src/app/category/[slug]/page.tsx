import { formatByUnit, type MetricSpec } from "@mf/shared";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";
import { Breadcrumbs } from "@/components/json-ld";
import { MetricHeader } from "@/components/metric-cell";
import { Card } from "@/components/ui";
import { getColumns, getMetadata, getScreen } from "@/lib/api";
import { categoryPages, categoryPath } from "@/lib/categories";
import { pageMetadata } from "@/lib/site";
import { exportedFundCodes } from "@/lib/static-data.server";

type Params = { params: Promise<{ slug: string }> };

const COLUMNS = [
  "cagr_3y",
  "cagr_5y",
  "rolling_3y_median",
  "rolling_3y_min",
  "rolling_5y_median",
  "rolling_5y_min",
  "expense_ratio",
];

export const dynamicParams = false;

export const generateStaticParams = async () =>
  (await categoryPages()).map(({ slug }) => ({ slug }));

// Shared by the metadata and the page, so both state the same fund count.
const load = cache(async (slug: string) => {
  const page = (await categoryPages()).find((p) => p.slug === slug);
  if (!page) notFound();
  // The screener's own defaults (Direct, Growth, one row per fund family), sorted by name.
  const query = new URLSearchParams({
    sub_category: page.subCategory,
    columns: COLUMNS.join(","),
    sort: "scheme_name:asc",
    page_size: "500",
  });
  return { page, result: await getScreen(query.toString()) };
});

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { page, result } = await load((await params).slug);
  return pageMetadata(
    categoryPath(page),
    `${page.subCategory}: rolling returns of every fund`,
    `Trailing and rolling 3 and 5-year returns, worst stretches and expense ratios for the ` +
      `${result.total} active Direct Growth funds in AMFI's ${page.subCategory} sub-category, ` +
      `computed from AMFI NAV history. Listed A to Z, not ranked. Not investment advice.`,
  );
}

export default async function CategoryPage({ params }: Params) {
  const { page, result } = await load((await params).slug);
  const [columns, metadata, published] = await Promise.all([
    getColumns(),
    getMetadata(),
    exportedFundCodes(),
  ]);
  const specs = new Map<string, MetricSpec>(columns.metrics.map((m) => [m.name, m]));
  const withPage = new Set(published);
  const screenerHref = `/screener?${new URLSearchParams({ sub_category: page.subCategory })}`;

  return (
    <div className="space-y-6">
      <Breadcrumbs
        trail={[
          ["Home", "/"],
          ["Fund categories", "/category/"],
          [page.subCategory, categoryPath(page)],
        ]}
      />
      <header className="max-w-3xl space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight text-balance">
          {page.subCategory}: rolling returns of every fund
        </h1>
        <p className="text-sm text-ink-700">
          {`The ${result.total} active Direct Growth ${result.total === 1 ? "fund" : "funds"} in AMFI's ${page.subCategory} sub-category${page.category ? ` (${page.category})` : ""}, one row per fund. Every figure is computed from AMFI's published NAV history, with metrics as of ${metadata.coverage.metrics_as_of ?? "-"}.`}
        </p>
        <p className="text-sm text-ink-700">
          Listed A to Z, not ranked.{" "}
          <Link href={screenerHref} className="text-accent-600 hover:underline">
            Sort and filter this sub-category in the screener
          </Link>
          , or{" "}
          <Link href="/compare" className="text-accent-600 hover:underline">
            compare up to five funds side by side
          </Link>
          .
        </p>
        <p className="border-l-2 border-warn-300 pl-3 text-xs text-ink-500">
          {metadata.disclaimer}
        </p>
      </header>

      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-ink-500">
              <tr className="align-bottom">
                <th scope="col" className="min-w-56 py-2 pr-4 font-medium">
                  Fund
                </th>
                {/* Wide enough that every label wraps to two lines, not three: a third line
                    on one header leaves a gap above every bottom-aligned label beside it. The
                    fee's label is the longest, and the system font is wider on some phones. */}
                {COLUMNS.map((name) => (
                  <th
                    key={name}
                    scope="col"
                    className={`${name === "expense_ratio" ? "min-w-40" : "min-w-28"} py-2 pr-4 font-medium`}
                  >
                    <MetricHeader spec={specs.get(name)} name={name} />
                  </th>
                ))}
              </tr>
            </thead>
            {/* Bare cells styled from the table: an Index Funds page has hundreds of rows,
                and per-cell classes and tooltips once made it 2 MB. */}
            <tbody className="[&_td]:py-2 [&_td]:pr-4 [&_td]:tabular-nums [&_th]:py-2 [&_th]:pr-4 [&_th]:text-left [&_th]:font-normal [&_tr]:border-t [&_tr]:border-ink-100">
              {result.rows.map((row) => {
                const code = String(row.scheme_code);
                const name = String(row.scheme_name);
                return (
                  <tr key={code}>
                    <th scope="row">
                      {/* A plain anchor: a Link would prefetch every fund page in view. */}
                      {withPage.has(code) ? (
                        <a href={`/fund/${code}/`} className="text-ink-900 hover:underline">
                          {name}
                        </a>
                      ) : (
                        name
                      )}
                    </th>
                    {COLUMNS.map((column) => (
                      <td key={column}>
                        {formatByUnit(row[column], specs.get(column)?.unit ?? "percent")}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <p className="max-w-3xl text-xs text-ink-500">
        A rolling return is the per-year return over every overlapping 3 or 5-year stretch of a
        fund&rsquo;s history: the typical figure is the median of those stretches and the worst is
        the lowest, which is what an unlucky investor actually got.{" "}
        <Link href="/glossary#rolling-vs-trailing" className="text-accent-600 hover:underline">
          Why rolling returns say more than one trailing return
        </Link>
        . A dash means the figure could not be computed, usually because the fund is too young; the
        fund&rsquo;s own page says why.
      </p>
    </div>
  );
}
