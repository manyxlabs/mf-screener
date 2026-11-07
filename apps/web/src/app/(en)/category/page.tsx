import Link from "@/components/link";
import { Breadcrumbs } from "@/components/json-ld";
import { Card } from "@/components/ui";
import { categoryPages, categoryPath, type CategoryPage } from "@/lib/categories";
import { routeI18n, type LocaleParams } from "@/lib/i18n/server";
import { pageMetadata } from "@/lib/site";

export async function generateMetadata({ params }: LocaleParams) {
  const i18n = await routeI18n(params);
  const { categories } = i18n.t;
  return pageMetadata(i18n, "/category/", categories.metaTitle, categories.metaDescription);
}

export default async function CategoriesPage({ params }: LocaleParams) {
  const { t } = await routeI18n(params);
  const groups = new Map<string, CategoryPage[]>();
  for (const page of await categoryPages()) {
    const key = page.category ?? t.categories.other;
    groups.set(key, [...(groups.get(key) ?? []), page]);
  }
  return (
    <div className="space-y-6">
      <Breadcrumbs trail={[[t.footer.categories, "/category/"]]} />
      <header className="max-w-3xl space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">{t.footer.categories}</h1>
        <p className="text-sm text-ink-700">{t.categories.lede}</p>
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
