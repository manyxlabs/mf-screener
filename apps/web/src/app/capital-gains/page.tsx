import { pageMetadata } from "@/lib/site";
import { CapitalGainsClient } from "./capital-gains-client";

export const metadata = pageMetadata(
  "/capital-gains/",
  "Mutual fund capital gains calculator",
  "Estimate capital gains on Indian mutual fund units by financial year: FIFO lots, short and long-term gains under sections 111A, 112 and 112A, and the tax. An estimate, not tax advice.",
);

// The heading is static, so it is in the HTML before the visitor's saved trades load.
export default function CapitalGainsPage() {
  return (
    <div className="space-y-6">
      <header className="max-w-3xl space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Capital gains calculator</h1>
        <p className="text-sm text-ink-700">
          Enter your mutual fund purchases and redemptions to see the capital gains in each
          financial year, matched first-in first-out and split the way the Income Tax Act treats
          them, with the tax worked out.
        </p>
        <p className="text-xs text-ink-500">
          What you enter stays in this browser and is never sent anywhere. Record a switch as a sale
          in the fund you left and a purchase in the fund you joined, on the switch date.
        </p>
      </header>
      <CapitalGainsClient />
    </div>
  );
}
