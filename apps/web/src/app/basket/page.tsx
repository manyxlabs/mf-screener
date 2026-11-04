import { Suspense } from "react";
import { pageMetadata } from "@/lib/site";
import { BasketClient } from "./basket-client";

export const metadata = pageMetadata(
  "/basket/",
  "Mutual fund basket analysis: correlation and blended risk",
  "Give a few Indian mutual funds a weight each and see how they move together: return correlation, and what blending them does to return, volatility and worst fall. Not investment advice.",
);

export default function BasketPage() {
  return (
    <Suspense fallback={<p className="text-sm text-ink-500">Loading basket...</p>}>
      <BasketClient />
    </Suspense>
  );
}
