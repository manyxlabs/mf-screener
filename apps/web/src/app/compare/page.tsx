import { Suspense } from "react";
import { getColumns } from "@/lib/api";
import { pageMetadata } from "@/lib/site";
import { CompareClient } from "./compare-client";
import { MAX_FUNDS } from "./compare-rows";

export const metadata = pageMetadata(
  "/compare/",
  "Compare mutual funds side by side",
  "Compare up to five Indian mutual funds on trailing and rolling returns, returns against their sub-category, worst falls, risk ratios and cost, with the best and worst value in each row marked. Not investment advice.",
);

export default async function ComparePage() {
  const columns = await getColumns();
  // The heading sits outside the Suspense boundary: the client part reads the URL, so a
  // static export renders only the fallback for it.
  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Compare funds</h1>
        <p className="max-w-3xl text-sm text-ink-500">
          Up to {MAX_FUNDS} funds side by side. In each row the best value is marked ▲ and the worst
          ▼, judged by that metric&apos;s own better direction. Rows where neither end is better,
          such as beta, are left unmarked.
        </p>
      </header>
      <Suspense fallback={<p className="text-sm text-ink-500">Loading comparison...</p>}>
        <CompareClient columnsMeta={columns} />
      </Suspense>
    </div>
  );
}
