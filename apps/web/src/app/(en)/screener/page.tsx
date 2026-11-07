import { Suspense } from "react";
import { getColumns, getFacets, getPresets } from "@/lib/api";
import { routeI18n, type LocaleParams } from "@/lib/i18n/server";
import { pageMetadata } from "@/lib/site";
import { ScreenerClient } from "./screener-client";

export async function generateMetadata({ params }: LocaleParams) {
  const i18n = await routeI18n(params);
  return pageMetadata(
    i18n,
    "/screener/",
    i18n.t.screener.metaTitle,
    i18n.t.screener.metaDescription,
  );
}

export default async function ScreenerPage({ params }: LocaleParams) {
  const [{ t }, columns, presets, facets] = await Promise.all([
    routeI18n(params),
    getColumns(),
    getPresets(),
    getFacets(),
  ]);

  // The heading sits outside the Suspense boundary: the client part reads the URL, so a
  // static export renders only the fallback for it.
  return (
    <div className="space-y-1">
      <h1 className="text-2xl font-semibold tracking-tight">{t.screener.title}</h1>
      <Suspense fallback={<p className="text-sm text-ink-500">{t.screener.loadingScreener}</p>}>
        <ScreenerClient columnsMeta={columns} presets={presets} facets={facets} />
      </Suspense>
    </div>
  );
}
