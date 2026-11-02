import type { FundType } from "./rules";

// Overseas funds sit in the AMFI equity and thematic categories too, but are taxed as
// non-equity funds, so a name like this stops the category from deciding.
const OVERSEAS =
  /\b(us|u\.s\.|international|global|overseas|asian?|japan|taiwan|china|nasdaq|s&p 500|hang seng|world|emerging|europe|feeder)\b/i;

const HYBRID: Record<string, FundType> = {
  "Aggressive Hybrid Fund": "equity",
  "Arbitrage Fund": "equity",
  "Equity Savings": "equity",
  "Equity Savings Fund": "equity",
  "Balanced Hybrid Fund": "hybrid",
  "Conservative Hybrid Fund": "debt",
};

/**
 * The tax type a SEBI category implies, or null where the category alone does not settle
 * it (index funds, ETFs, fund of funds, balanced advantage, multi asset): those depend on
 * the scheme's own equity share, so the user chooses.
 */
export function fundTypeFromCategory(
  category: string | null,
  subCategory: string | null,
  name: string,
): FundType | null {
  if (OVERSEAS.test(name)) return null;
  if (category === "Equity Scheme") return "equity";
  if (category === "Debt Scheme") return "debt";
  if (category === "Hybrid Scheme") return HYBRID[subCategory ?? ""] ?? null;
  return null;
}

/** ETFs trade on an exchange, which changes their holding period and 2018 fair value. */
export const looksListed = (name: string) => /\b(ETF|BeES)\b/i.test(name);
