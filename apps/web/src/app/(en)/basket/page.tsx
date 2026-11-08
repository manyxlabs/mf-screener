import { Suspense } from "react";
import { routeI18n, type LocaleParams } from "@/lib/i18n/server";
import { pageMetadata } from "@/lib/site";
import { BasketClient } from "./basket-client";

export async function generateMetadata({ params }: LocaleParams) {
  const i18n = await routeI18n(params);
  return pageMetadata(i18n, "/basket/", i18n.t.basket.metaTitle, i18n.t.basket.metaDescription);
}

export default async function BasketPage({ params }: LocaleParams) {
  const { t } = await routeI18n(params);
  return (
    <Suspense fallback={<p className="text-sm text-ink-500">{t.basket.loading}</p>}>
      <BasketClient />
    </Suspense>
  );
}
