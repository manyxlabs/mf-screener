// Indian capital gains rules for mutual fund units by date of transfer: the Income-tax Act
// 1961 to 31 Mar 2026, then the Income-tax Act 2025, which carried the same rules over.
// The page cites the source of every constant here.

import type { IsoDate } from "@/lib/cas/types";

/**
 * - equity: an equity-oriented fund (65% or more in domestic listed equity).
 * - debt: more than 65% in debt and money market instruments, a specified mutual fund
 *   under both the Finance Act 2023 and the Finance (No. 2) Act 2024 definitions.
 * - hybrid: more than 35% but under 65% in domestic equity; never a specified fund.
 * - other: 35% or less in domestic equity and no more than 65% in debt (gold, silver,
 *   international, most fund of funds): specified only under the 2023 definition.
 */
export type FundType = "equity" | "debt" | "hybrid" | "other";

/** Section 111A and 112A rates and the 112 rate changed for transfers from this date. */
export const BUDGET_2024 = "2024-07-23";
/** Section 50AA catches specified fund units bought from this date. */
export const SPECIFIED_FROM = "2023-04-01";
/**
 * The Finance (No. 2) Act 2024 redefined a specified fund from AY 2026-27, so for every
 * transfer in FY 2025-26 onward.
 */
export const SPECIFIED_REDEFINED = "2025-04-01";
/** Section 112A taxes equity LTCG on transfers from this date; 10(38) exempted it before. */
export const SECTION_112A_FROM = "2018-04-01";
/** 112A grandfathers gains accrued up to 31 Jan 2018 on units bought before 1 Feb 2018. */
export const GRANDFATHER_BEFORE = "2018-02-01";
export const CESS = 0.04;

/** Section 112A: tax-free equity LTCG per financial year. */
export const equityExemption = (fyStart: number) => (fyStart >= 2024 ? 125_000 : 100_000);

// CBDT Notification 44/2017 and the yearly notifications after it. Indexation stopped for
// transfers from 23 Jul 2024, so no later year is needed.
const CII: Record<number, number> = {
  2001: 100,
  2002: 105,
  2003: 109,
  2004: 113,
  2005: 117,
  2006: 122,
  2007: 129,
  2008: 137,
  2009: 148,
  2010: 167,
  2011: 184,
  2012: 200,
  2013: 220,
  2014: 240,
  2015: 254,
  2016: 264,
  2017: 272,
  2018: 280,
  2019: 289,
  2020: 301,
  2021: 317,
  2022: 331,
  2023: 348,
  2024: 363,
};

/**
 * Units bought before 1 Apr 2001 may use their actual cost against the 2001-02 index, one
 * of the two options section 55(2)(b) gives.
 */
export function indexedCost(cost: number, bought: IsoDate, sold: IsoDate): number {
  const from = CII[Math.max(2001, fyStart(bought))];
  const to = CII[fyStart(sold)];
  if (from === undefined || to === undefined)
    throw new Error(`No cost inflation index for ${sold}`);
  return (cost * to) / from;
}

export function fyStart(date: IsoDate): number {
  const [year, month] = date.split("-").map(Number) as [number, number];
  return month >= 4 ? year : year - 1;
}

export const fyLabel = (start: number) => `${start}-${String((start + 1) % 100).padStart(2, "0")}`;

/** The same day `months` later, or that month's last day when it is shorter. */
export function addMonths(date: IsoDate, months: number): IsoDate {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const total = y * 12 + (m - 1) + months;
  const year = Math.floor(total / 12);
  const month = total % 12;
  const last = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, month, Math.min(d, last))).toISOString().slice(0, 10);
}

export function addDays(date: IsoDate, days: number): IsoDate {
  const t = new Date(`${date}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + days);
  return t.toISOString().slice(0, 10);
}

export function isSpecifiedFund(type: FundType, bought: IsoDate, sold: IsoDate): boolean {
  if (bought < SPECIFIED_FROM) return false;
  return type === "debt" || (type === "other" && sold < SPECIFIED_REDEFINED);
}

/**
 * Section 2(42A): long-term when held more than 12 months (36 or 24 for other units). From
 * 23 Jul 2024 every listed security, ETF units included, needs only 12.
 */
const holdingMonths = (type: FundType, listed: boolean, sold: IsoDate) =>
  type === "equity" ? 12 : sold < BUDGET_2024 ? 36 : listed ? 12 : 24;

/**
 * The first day a sale is long-term. Units bought on 1 Jan complete 12 months on 31 Dec,
 * so a sale on 1 Jan of the next year is long-term (Delhi High Court, Bharti Gupta Ramola
 * v. CIT, 2012).
 */
const firstLongDay = (bought: IsoDate, months: number) =>
  addDays(addMonths(addDays(bought, -1), months), 1);

/** Where a gain is taxed. A null rate is the investor's slab rate. */
export type TaxHead =
  | { section: "111A"; term: "short"; rate: 0.15 | 0.2 }
  | { section: "112A"; term: "long"; rate: 0.1 | 0.125 }
  | { section: "112"; term: "long"; rate: 0.2 | 0.125; indexed: boolean }
  | { section: "slab"; term: "short"; rate: null; specified: boolean }
  // Before FY 2018-19: matched so later sales use the right lots, but not taxed here.
  | { section: "pre2018"; term: "short" | "long"; rate: null };

export function classify(type: FundType, bought: IsoDate, sold: IsoDate, listed = false): TaxHead {
  const long = sold >= firstLongDay(bought, holdingMonths(type, listed, sold));
  const after = sold >= BUDGET_2024;
  if (sold < SECTION_112A_FROM)
    return { section: "pre2018", term: long ? "long" : "short", rate: null };
  if (isSpecifiedFund(type, bought, sold))
    return { section: "slab", term: "short", rate: null, specified: true };
  if (type === "equity") {
    return long
      ? { section: "112A", term: "long", rate: after ? 0.125 : 0.1 }
      : { section: "111A", term: "short", rate: after ? 0.2 : 0.15 };
  }
  if (!long) return { section: "slab", term: "short", rate: null, specified: false };
  return after
    ? { section: "112", term: "long", rate: 0.125, indexed: false }
    : { section: "112", term: "long", rate: 0.2, indexed: true };
}

/**
 * The first day a unit bought on `bought` would be long-term if sold then, judged by the
 * rules in force on `asOf`; null when a sale under those rules can never be long-term.
 */
export function longTermFrom(
  type: FundType,
  bought: IsoDate,
  asOf: IsoDate,
  listed = false,
): IsoDate | null {
  if (type === "debt" && bought >= SPECIFIED_FROM) return null;
  if (type === "other" && bought >= SPECIFIED_FROM && asOf < SPECIFIED_REDEFINED) return null;
  return firstLongDay(bought, holdingMonths(type, listed, asOf));
}

/** The Income-tax Act 2025 renumbered these sections for transfers from 1 Apr 2026. */
const ACT_2025: Record<string, string> = {
  "111A": "196",
  "112": "197",
  "112A": "198",
  "50AA": "76",
};
export const sectionName = (section: string, sold: IsoDate) =>
  sold >= "2026-04-01" ? `${ACT_2025[section] ?? section} (2025 Act)` : section;
