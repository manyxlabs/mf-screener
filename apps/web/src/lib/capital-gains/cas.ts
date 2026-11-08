import type { CasScheme, CasTransactionKind, IsoDate } from "@/lib/cas/types";
import type { Trade } from "./engine";

const BUY: ReadonlySet<CasTransactionKind> = new Set([
  "purchase",
  "switch_in",
  "dividend_reinvest",
  "bonus",
]);
const SELL: ReadonlySet<CasTransactionKind> = new Set(["redemption", "switch_out"]);
// Payouts are income, not a transfer; duty and tax lines move no units. Stamp duty is
// strictly part of cost, but at 0.005% of a purchase it is left out.
const IGNORED: ReadonlySet<CasTransactionKind> = new Set([
  "dividend_payout",
  "stamp_duty",
  "stt",
  "tds",
]);

/** Kinds whose units arrive with history the statement does not show. */
export type UnhandledKind = "merger_in" | "merger_out" | "other";

export type Unsupported =
  { reason: "openingUnits" } | { reason: "unhandled"; kind: UnhandledKind; date: IsoDate };

/**
 * The trades of one folio's scheme, or why they cannot be matched. A merger carries the
 * old scheme's cost and dates (section 47(xviii)) and an opening balance hides them, so
 * either leaves the lots unknown.
 */
export function tradesFromCas(
  scheme: CasScheme,
): { trades: Trade[] } | { unsupported: Unsupported } {
  if (Math.abs(scheme.openingUnits) > 1e-4) {
    return { unsupported: { reason: "openingUnits" } };
  }
  const trades: Trade[] = [];
  for (const t of scheme.transactions) {
    if (IGNORED.has(t.kind)) continue;
    // Bonus units cost nothing and date from their allotment (section 55(2)(aa)).
    if (BUY.has(t.kind))
      trades.push({
        date: t.date,
        side: "buy",
        units: Math.abs(t.units),
        amount: t.kind === "bonus" ? 0 : Math.abs(t.amount),
      });
    else if (SELL.has(t.kind))
      trades.push({
        date: t.date,
        side: "sell",
        units: Math.abs(t.units),
        amount: Math.abs(t.amount),
      });
    else
      return {
        unsupported: { reason: "unhandled", kind: t.kind as UnhandledKind, date: t.date },
      };
  }
  return { trades };
}
