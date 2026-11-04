import Link from "next/link";
import { Breadcrumbs } from "@/components/json-ld";
import { Card } from "@/components/ui";
import { categoryPages, categoryPath, type CategoryPage } from "@/lib/categories";
import { pageMetadata } from "@/lib/site";

export const metadata = pageMetadata(
  "/category/",
  "Mutual fund categories: rolling returns by sub-category",
  "Every Indian mutual fund sub-category with enough funds to compare, from Large Cap and Mid Cap to liquid and gilt funds, each with trailing and rolling returns for all its funds. Not investment advice.",
);

export default async function CategoriesPage() {
  const groups = new Map<string, CategoryPage[]>();
  for (const page of await categoryPages()) {
    const key = page.category ?? "Other";
    groups.set(key, [...(groups.get(key) ?? []), page]);
  }
  return (
    <div className="space-y-6">
      <Breadcrumbs
        trail={[
          ["Home", "/"],
          ["Fund categories", "/category/"],
        ]}
      />
      <header className="max-w-3xl space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Fund categories</h1>
        <p className="text-sm text-ink-700">
          Every sub-category AMFI uses with enough funds to compare, named as AMFI names them. Each
          page lists all of its active Direct Growth funds A to Z with their trailing and rolling
          returns, worst stretches and expense ratios. A fund is only ever measured against funds of
          its own kind.
        </p>
      </header>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {[...groups].map(([category, pages]) => (
          <Card key={category} title={category}>
            <ul className="space-y-1.5 text-sm">
              {pages.map((page) => (
                <li key={page.slug}>
                  <Link href={categoryPath(page)} className="text-accent-600 hover:underline">
                    {page.subCategory}
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        ))}
      </div>
    </div>
  );
}
