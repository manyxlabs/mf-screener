import { Suspense } from "react";
import { getColumns, getFacets, getPresets } from "@/lib/api";
import { pageMetadata } from "@/lib/site";
import { ScreenerClient } from "./screener-client";

export const metadata = pageMetadata(
  "/screener/",
  "Mutual fund screener: filter by rolling returns, risk and cost",
  "Filter every active Indian mutual fund on trailing and rolling returns, worst falls, peer-relative performance, risk-adjusted ratios and expense ratio, then save the screen or export it as CSV. Not investment advice.",
);

export default async function ScreenerPage() {
  const [columns, presets, facets] = await Promise.all([getColumns(), getPresets(), getFacets()]);

  // The heading sits outside the Suspense boundary: the client part reads the URL, so a
  // static export renders only the fallback for it.
  return (
    <div className="space-y-1">
      <h1 className="text-2xl font-semibold tracking-tight">Mutual fund screener</h1>
      <Suspense fallback={<p className="text-sm text-ink-500">Loading screener...</p>}>
        <ScreenerClient columnsMeta={columns} presets={presets} facets={facets} />
      </Suspense>
    </div>
  );
}
