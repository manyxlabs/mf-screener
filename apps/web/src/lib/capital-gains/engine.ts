// FIFO lot matching, per-year tax and the unrealised view. Pure, so the same code serves
// hand-entered trades and trades read from a CAS statement.

import type { IsoDate } from "@/lib/cas/types";
import {
  CESS,
  classify,
  equityExemption,
  fyStart,
  GRANDFATHER_BEFORE,
  indexedCost,
  longTermFrom,
  type FundType,
  type TaxHead,
} from "./rules";

/** Units and amount are positive; `amount` is the cost of a buy or the proceeds of a sale. */
export type Trade = { date: IsoDate; side: "buy" | "sell"; units: number; amount: number };

/** One folio of one scheme: FIFO runs within it and never across. */
export type Holding = {
  id: string;
  name: string;
  type: FundType;
  /** Traded on a stock exchange (an ETF): 12 months makes it long-term from 23 Jul 2024. */
  listed: boolean;
  /**
   * Fair market value per unit on 31 Jan 2018, for grandfathering under section 112A: the
   * NAV, or for a listed unit the highest price it traded at that day.
   */
  nav31Jan2018: number | null;
  trades: Trade[];
  latest: { date: IsoDate; nav: number } | null;
};

export type RealisedLot = {
  holdingId: string;
  bought: IsoDate;
  sold: IsoDate;
  units: number;
  cost: number;
  /** Cost after grandfathering or indexation: what the gain is measured from. */
  taxCost: number;
  proceeds: number;
  gain: number;
  head: TaxHead;
  /** A pre-2018 equity lot whose 31 Jan 2018 value is unknown: its gain is not computed. */
  needsNav31Jan2018: boolean;
};

export type OpenLot = {
  holdingId: string;
  bought: IsoDate;
  units: number;
  cost: number;
  value: number | null;
  gain: number | null;
  /** The tax head a sale on `asOf` would fall under. */
  head: TaxHead;
  longTermFrom: IsoDate | null;
};

/** Gains under one head and rate. Slab gains carry a null rate. */
export type Bucket = {
  key: string;
  head: TaxHead;
  term: "short" | "long";
  rate: number | null;
  /** After set-off of losses. */
  gain: number;
  /** The part of `gain` the section 112A exemption covers. */
  exempt: number;
  /** Before cess; null for slab gains without a slab rate. */
  tax: number | null;
};

export type YearSummary = {
  fyStart: number;
  /** Before FY 2018-19 the year is listed for its gains but not taxed. */
  covered: boolean;
  /** False while any lot of the year lacks its 31 Jan 2018 value. */
  complete: boolean;
  shortTerm: number;
  longTerm: number;
  buckets: Bucket[];
  exemptionLimit: number;
  exemptionUsed: number;
  /** Tax at the special rates of 111A, 112 and 112A, before cess. */
  specialTax: number;
  slabGain: number;
  slabTax: number | null;
  cess: number | null;
  total: number | null;
};

export type GainsResult =
  | {
      ok: true;
      realised: RealisedLot[];
      years: YearSummary[];
      open: OpenLot[];
      /** This year's 112A exemption left after realised equity LTCG. */
      exemptionLeft: { fyStart: number; limit: number; left: number };
    }
  | { ok: false; errors: EntryError[] };

export type EntryError =
  | {
      problem: "invalidDate" | "futureDate" | "units" | "amount";
      fund: string;
      side: Trade["side"];
      date: string;
    }
  | { problem: "nav31Jan2018"; fund: string }
  | { problem: "slabRate" }
  | { problem: "oversold"; fund: string; date: IsoDate; units: number; held: number };

// Statements print units to three or four decimals, so a full redemption can differ from
// the lots it empties by rounding; anything smaller than this is that rounding.
const UNIT_EPSILON = 1e-4;
const ISO = /^\d{4}-\d{2}-\d{2}$/;

function validate(h: Holding, asOf: IsoDate): EntryError[] {
  const errors: EntryError[] = [];
  for (const t of h.trades) {
    const at = (problem: "invalidDate" | "futureDate" | "units" | "amount") =>
      errors.push({ problem, fund: h.name, side: t.side, date: t.date });
    if (!ISO.test(t.date) || Number.isNaN(Date.parse(t.date))) at("invalidDate");
    else if (t.date > asOf) at("futureDate");
    if (!(t.units > 0) || !Number.isFinite(t.units)) at("units");
    if (!(t.amount >= 0) || !Number.isFinite(t.amount)) at("amount");
  }
  if (h.nav31Jan2018 !== null && !(h.nav31Jan2018 > 0))
    errors.push({ problem: "nav31Jan2018", fund: h.name });
  return errors;
}

/** 112A(2): the higher of actual cost and the lower of the 31 Jan 2018 value and the proceeds. */
const grandfathered = (cost: number, fmv: number, proceeds: number) =>
  Math.max(cost, Math.min(fmv, proceeds));

function taxCostOf(
  h: Holding,
  head: TaxHead,
  bought: IsoDate,
  sold: IsoDate,
  units: number,
  cost: number,
  proceeds: number,
) {
  if (head.section === "112" && head.indexed) return indexedCost(cost, bought, sold);
  if (head.section === "112A" && bought < GRANDFATHER_BEFORE) {
    return h.nav31Jan2018 === null ? null : grandfathered(cost, h.nav31Jan2018 * units, proceeds);
  }
  return cost;
}

function matchHolding(
  h: Holding,
  asOf: IsoDate,
): { realised: RealisedLot[]; open: OpenLot[] } | { error: EntryError } {
  type Lot = { bought: IsoDate; units: number; cost: number };
  const lots: Lot[] = [];
  const realised: RealisedLot[] = [];
  // On one date, buys go first: a sale can only use a same-day buy once older lots are
  // gone, and then it must have.
  const trades = [...h.trades].sort(
    (a, b) => a.date.localeCompare(b.date) || (a.side === b.side ? 0 : a.side === "buy" ? -1 : 1),
  );
  for (const t of trades) {
    if (t.side === "buy") {
      lots.push({ bought: t.date, units: t.units, cost: t.amount });
      continue;
    }
    const held = lots.reduce((sum, lot) => sum + lot.units, 0);
    if (t.units > held + UNIT_EPSILON) {
      return { error: { problem: "oversold", fund: h.name, date: t.date, units: t.units, held } };
    }
    let left = Math.min(t.units, held);
    while (left > UNIT_EPSILON) {
      const lot = lots[0]!;
      const units = Math.min(lot.units, left);
      const cost = lot.units - units <= UNIT_EPSILON ? lot.cost : (lot.cost * units) / lot.units;
      const proceeds = (t.amount * units) / t.units;
      const head = classify(h.type, lot.bought, t.date, h.listed);
      const taxCost = taxCostOf(h, head, lot.bought, t.date, units, cost, proceeds);
      realised.push({
        holdingId: h.id,
        bought: lot.bought,
        sold: t.date,
        units,
        cost,
        taxCost: taxCost ?? cost,
        proceeds,
        gain: proceeds - (taxCost ?? cost),
        head,
        needsNav31Jan2018: taxCost === null,
      });
      left -= units;
      if (lot.units - units <= UNIT_EPSILON) lots.shift();
      else Object.assign(lot, { units: lot.units - units, cost: lot.cost - cost });
    }
  }
  const open: OpenLot[] = lots.map((lot) => {
    const head = classify(h.type, lot.bought, asOf, h.listed);
    const value = h.latest ? h.latest.nav * lot.units : null;
    const taxCost =
      value === null ? null : taxCostOf(h, head, lot.bought, asOf, lot.units, lot.cost, value);
    return {
      holdingId: h.id,
      bought: lot.bought,
      units: lot.units,
      cost: lot.cost,
      value,
      gain: value === null || taxCost === null ? null : value - taxCost,
      head,
      longTermFrom: longTermFrom(h.type, lot.bought, asOf, h.listed),
    };
  });
  return { realised, open };
}

const headKey = (head: TaxHead) => `${head.section}@${head.rate ?? "slab"}`;

/**
 * Sections 70 and 74 let a short-term loss reduce any gain and a long-term loss only a
 * long-term gain. The order across rates is the taxpayer's, so losses go to the highest
 * rate first, which is what a taxpayer would choose. Without a slab rate, slab gains rank
 * at the top 30% slab.
 */
function setOff(buckets: Bucket[], slabRate: number | null) {
  const rank = (b: Bucket) => b.rate ?? slabRate ?? 0.3;
  const gains = buckets.filter((b) => b.gain > 0).sort((a, b) => rank(b) - rank(a));
  const absorb = (loss: number, targets: Bucket[]) => {
    for (const target of targets) {
      const used = Math.min(loss, target.gain);
      target.gain -= used;
      loss -= used;
    }
  };
  for (const term of ["long", "short"] as const) {
    const loss = buckets
      .filter((b) => b.term === term && b.gain < 0)
      .reduce((s, b) => s - b.gain, 0);
    absorb(loss, term === "long" ? gains.filter((b) => b.term === "long") : gains);
  }
  return buckets.filter((b) => b.gain > 0);
}

function summarise(fy: number, lots: RealisedLot[], slabRate: number | null): YearSummary {
  const covered = lots.every((lot) => lot.head.section !== "pre2018");
  const complete = lots.every((lot) => !lot.needsNav31Jan2018);
  const sum = (term: "short" | "long") =>
    lots
      .filter((l) => l.head.term === term && !l.needsNav31Jan2018)
      .reduce((s, l) => s + l.gain, 0);
  const net = new Map<string, Bucket>();
  for (const lot of lots) {
    if (lot.needsNav31Jan2018) continue;
    const key = headKey(lot.head);
    const bucket = net.get(key) ?? {
      key,
      head: lot.head,
      term: lot.head.term,
      rate: lot.head.rate,
      gain: 0,
      exempt: 0,
      tax: null,
    };
    bucket.gain += lot.gain;
    net.set(key, bucket);
  }
  const buckets = covered ? setOff([...net.values()], slabRate) : [];
  const exemptionLimit = equityExemption(fy);
  // 112A taxes only what exceeds the limit; letting it cover the 12.5% gains of FY
  // 2024-25 before the 10% ones is the taxpayer's choice and the cheaper one.
  let exemptionLeft = exemptionLimit;
  for (const b of buckets
    .filter((b) => b.key.startsWith("112A@"))
    .sort((x, y) => y.rate! - x.rate!)) {
    b.exempt = Math.min(exemptionLeft, b.gain);
    exemptionLeft -= b.exempt;
  }
  for (const b of buckets) {
    const rate = b.rate ?? slabRate;
    b.tax = rate === null ? null : rate * (b.gain - b.exempt);
  }
  const specialTax = buckets.reduce((s, b) => s + (b.rate === null ? 0 : b.tax!), 0);
  const slabGain = buckets.filter((b) => b.rate === null).reduce((s, b) => s + b.gain, 0);
  const slabTax = slabRate === null ? (slabGain > 0 ? null : 0) : slabRate * slabGain;
  const beforeCess = !covered || slabTax === null ? null : specialTax + slabTax;
  return {
    fyStart: fy,
    covered,
    complete,
    shortTerm: sum("short"),
    longTerm: sum("long"),
    buckets,
    exemptionLimit,
    exemptionUsed: exemptionLimit - exemptionLeft,
    specialTax,
    slabGain,
    slabTax,
    cess: beforeCess === null ? null : beforeCess * CESS,
    total: beforeCess === null ? null : beforeCess * (1 + CESS),
  };
}

export function computeGains(
  holdings: Holding[],
  { asOf, slabRate }: { asOf: IsoDate; slabRate: number | null },
): GainsResult {
  const errors = holdings.flatMap((h) => validate(h, asOf));
  if (slabRate !== null && !(slabRate >= 0 && slabRate <= 1)) errors.push({ problem: "slabRate" });
  if (errors.length) return { ok: false, errors };
  const realised: RealisedLot[] = [];
  const open: OpenLot[] = [];
  for (const h of holdings) {
    const matched = matchHolding(h, asOf);
    if ("error" in matched) errors.push(matched.error);
    else {
      realised.push(...matched.realised);
      open.push(...matched.open);
    }
  }
  if (errors.length) return { ok: false, errors };
  const byYear = new Map<number, RealisedLot[]>();
  for (const lot of realised)
    byYear.set(fyStart(lot.sold), [...(byYear.get(fyStart(lot.sold)) ?? []), lot]);
  const years = [...byYear.entries()]
    .sort(([a], [b]) => b - a)
    .map(([fy, lots]) => summarise(fy, lots, slabRate));
  const thisYear = fyStart(asOf);
  const current = years.find((y) => y.fyStart === thisYear);
  const limit = equityExemption(thisYear);
  return {
    ok: true,
    realised,
    years,
    open,
    exemptionLeft: {
      fyStart: thisYear,
      limit,
      left: current ? limit - current.exemptionUsed : limit,
    },
  };
}
