import { Suspense } from "react";
import { getColumns } from "@/lib/api";
import { routeI18n, type LocaleParams } from "@/lib/i18n/server";
import { pageMetadata } from "@/lib/site";
import { CompareClient } from "./compare-client";
import { MAX_FUNDS } from "./compare-rows";

export async function generateMetadata({ params }: LocaleParams) {
  const i18n = await routeI18n(params);
  const { metaTitle, metaDescription } = i18n.t.compareView;
  return pageMetadata(i18n, "/compare/", metaTitle, metaDescription);
}

export default async function ComparePage({ params }: LocaleParams) {
  const [{ t, number }, columns] = await Promise.all([routeI18n(params), getColumns()]);
  // The heading sits outside the Suspense boundary: the client part reads the URL, so a
  // static export renders only the fallback for it.
  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{t.compareView.title}</h1>
        <p className="max-w-3xl text-sm text-ink-500">{t.compareView.intro(number(MAX_FUNDS))}</p>
      </header>
      <Suspense fallback={<p className="text-sm text-ink-500">{t.compareView.loading}</p>}>
        <CompareClient columnsMeta={columns} />
      </Suspense>
    </div>
  );
}
