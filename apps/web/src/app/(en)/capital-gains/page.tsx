import { routeI18n, type LocaleParams } from "@/lib/i18n/server";
import { pageMetadata } from "@/lib/site";
import { CapitalGainsClient } from "./capital-gains-client";

export async function generateMetadata({ params }: LocaleParams) {
  const i18n = await routeI18n(params);
  const c = i18n.t.capitalGains;
  return pageMetadata(i18n, "/capital-gains/", c.metaTitle, c.metaDescription);
}

// The heading is static, so it is in the HTML before the visitor's saved trades load.
export default async function CapitalGainsPage({ params }: LocaleParams) {
  const { t } = await routeI18n(params);
  return (
    <div className="space-y-6">
      <header className="max-w-3xl space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">{t.capitalGains.title}</h1>
        <p className="text-sm text-ink-700">{t.capitalGains.intro}</p>
        <p className="text-xs text-ink-500">{t.capitalGains.privacy}</p>
      </header>
      <CapitalGainsClient />
    </div>
  );
}
