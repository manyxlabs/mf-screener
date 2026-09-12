import { Suspense } from "react";
import { getColumns, getFacets, getPresets } from "@/lib/api";
import { ScreenerClient } from "./screener-client";

export const dynamic = "force-dynamic";

export default async function ScreenerPage() {
  const [columns, presets, facets] = await Promise.all([getColumns(), getPresets(), getFacets()]);

  return (
    <Suspense fallback={<p className="text-sm text-ink-500">Loading screener...</p>}>
      <ScreenerClient columnsMeta={columns} presets={presets} facets={facets} />
    </Suspense>
  );
}
