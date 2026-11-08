import Link from "@/components/link";
import { Card } from "@/components/ui";
import { routeI18n, type LocaleParams } from "@/lib/i18n/server";
import { pageMetadata } from "@/lib/site";

export async function generateMetadata({ params }: LocaleParams) {
  const i18n = await routeI18n(params);
  return pageMetadata(i18n, "/overlap/", i18n.t.overlap.metaTitle, i18n.t.overlap.metaDescription);
}

/**
 * How much of two funds' money is in the same instruments. Overlap reads holdings
 * someone imported, never anything computed from NAV, and the published site carries
 * none, so this page explains the gap rather than offering a picker that leads nowhere.
 */
export default async function OverlapPage({ params }: LocaleParams) {
  const { t } = await routeI18n(params);
  const o = t.overlap;
  return (
    <div className="space-y-4">
      <header className="max-w-3xl space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{o.title}</h1>
        <p className="text-sm text-ink-700">{o.intro}</p>
        <p className="text-xs text-ink-500">
          {o.measure}
          <Link className="underline" href="/basket">
            {o.measureLink}
          </Link>
          {o.measureAfter}
        </p>
      </header>

      <Card title={o.noHoldings}>
        <p className="max-w-3xl text-sm text-ink-700">
          {o.noHoldingsBody}
          <code className="rounded bg-ink-100 px-1">make holdings-import FILE=...</code>
          {o.noHoldingsRead}
          <code className="rounded bg-ink-100 px-1">GET /overlap</code>
          {o.noHoldingsAfter}
        </p>
      </Card>
    </div>
  );
}
