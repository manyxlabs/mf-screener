import { formatByUnit, type MetricSpec } from "@mf/shared";
import type { Metadata } from "next";
import Link from "@/components/link";
import { notFound } from "next/navigation";
import { cache } from "react";
import { Breadcrumbs } from "@/components/json-ld";
import { MetricHeader } from "@/components/metric-cell";
import { Card } from "@/components/ui";
import { getColumns, getMetadata, getScreen } from "@/lib/api";
import { categoryPages, categoryPath } from "@/lib/categories";
import { routeI18n } from "@/lib/i18n/server";
import { pageMetadata } from "@/lib/site";
import { exportedFundCodes } from "@/lib/static-data.server";

type Params = { params: Promise<{ lang?: string; slug: string }> };

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
  const [i18n, { page, result }] = await Promise.all([
    routeI18n(params),
    load((await params).slug),
  ]);
  const { category } = i18n.t;
  return pageMetadata(
    i18n,
    categoryPath(page),
    category.title(page.subCategory),
    category.metaDescription(i18n.number(result.total), page.subCategory),
  );
}

export default async function CategoryPage({ params }: Params) {
  const { page, result } = await load((await params).slug);
  const [{ t, td, number }, columns, metadata, published] = await Promise.all([
    routeI18n(params),
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
          [t.footer.categories, "/category/"],
          [page.subCategory, categoryPath(page)],
        ]}
      />
      <header className="max-w-3xl space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl text-balance">
          {t.category.title(page.subCategory)}
        </h1>
        <p className="text-sm text-ink-700">
          {t.category.lede(
            result.total,
            number(result.total),
            page.subCategory,
            page.category,
            metadata.coverage.metrics_as_of ?? "-",
          )}
        </p>
        <p className="text-sm text-ink-700">
          {t.category.listed}
          <Link href={screenerHref} className="text-accent-600 hover:underline">
            {t.category.inScreener}
          </Link>
          {t.category.or}
          <Link href="/compare" className="text-accent-600 hover:underline">
            {t.category.compare}
          </Link>
          {t.category.end}
        </p>
        <p className="border-l-2 border-warn-300 pl-3 text-xs text-ink-500">
          {td(metadata.disclaimer)}
        </p>
      </header>

      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-ink-500">
              <tr className="align-bottom">
                <th scope="col" className="min-w-56 py-2 pr-4 font-medium">
                  {t.table.columns.scheme_name}
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
                        {formatByUnit(row[column], specs.get(column)?.unit ?? "percent", t.units)}
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
        {t.category.rollingBefore}
        <Link href="/glossary#rolling-vs-trailing" className="text-accent-600 hover:underline">
          {t.category.rollingLink}
        </Link>
        {t.category.rollingAfter}
      </p>
    </div>
  );
}
