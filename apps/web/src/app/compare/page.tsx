import { Suspense } from "react";
import { getColumns } from "@/lib/api";
import { CompareClient } from "./compare-client";

export default async function ComparePage() {
  const columns = await getColumns();
  return (
    <Suspense fallback={<p className="text-sm text-ink-500">Loading comparison...</p>}>
      <CompareClient columnsMeta={columns} />
    </Suspense>
  );
}
