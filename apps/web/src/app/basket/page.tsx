import { Suspense } from "react";
import { BasketClient } from "./basket-client";

export default function BasketPage() {
  return (
    <Suspense fallback={<p className="text-sm text-ink-500">Loading basket...</p>}>
      <BasketClient />
    </Suspense>
  );
}
