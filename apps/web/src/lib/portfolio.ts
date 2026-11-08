/**
 * The portfolio checkup: a parsed CAS joined to the screener's own data by ISIN, valued at
 * the latest NAV the site carries. Every figure that cannot be computed honestly is a
 * reason instead of a number.
 */
import type { CasScheme, CasStatement } from "./cas/types";
import { loadScreenColumn } from "./static-data";
import { xirr, type CashFlow } from "./xirr";
import type { Messages } from "@/messages/en";

/** Why a figure is missing, as a code the page words in its language. */
export type Reason = keyof Messages["portfolio"]["reasons"];

/** `holding` names the holding a portfolio total is missing because of. */
export type Figure =
  { value: number; reason?: undefined } | { value: null; reason: Reason; holding?: string };

const known = (value: number): Figure => ({ value });
const unknown = (reason: Reason, holding?: string): Figure => ({ value: null, reason, holding });

const COLUMNS = [
  "scheme_code",
  "scheme_name",
  "isin_growth",
  "isin_dividend",
  "latest_nav",
  "latest_nav_date",
  "expense_ratio",
  "clean_plan",
  "clean_option",
  "fund_family_id",
  "clean_category",
  "clean_sub_category",
] as const;

type Row = {
  [K in (typeof COLUMNS)[number]]: K extends "latest_nav" | "expense_ratio"
    ? number | null
    : string | null;
};

export type FundData = { byIsin: Map<string, Row>; byFamily: Map<string, Row[]> };

export async function loadFundData(): Promise<FundData> {
  const columns = await Promise.all(COLUMNS.map((name) => loadScreenColumn(name)));
  const rows = columns[0]!.map(
    (_, i) => Object.fromEntries(COLUMNS.map((name, c) => [name, columns[c]![i] ?? null])) as Row,
  );
  const byIsin = new Map<string, Row>();
  const byFamily = new Map<string, Row[]>();
  for (const row of rows) {
    // The growth (or IDCW payout) and IDCW reinvestment ISINs of one scheme code; a handful
    // of ISINs repeat across codes, and the first listed is kept.
    for (const isin of [row.isin_growth, row.isin_dividend])
      if (isin && !byIsin.has(isin)) byIsin.set(isin, row);
    if (row.fund_family_id)
      byFamily.set(row.fund_family_id, [...(byFamily.get(row.fund_family_id) ?? []), row]);
  }
  return { byIsin, byFamily };
}

export type DirectPlan = {
  schemeCode: string;
  name: string;
  expenseRatio: number;
  /** Rupees a year at today's value: the regular plan's ratio less the direct plan's. */
  difference: Figure;
};

export type Holding = {
  key: string;
  name: string;
  schemeCode: string | null;
  folios: string[];
  units: number;
  nav: { value: number; date: string; source: "site" | "statement" } | null;
  value: Figure;
  cost: Figure;
  gain: Figure;
  xirr: Figure;
  category: string | null;
  subCategory: string | null;
  plan: string | null;
  expenseRatio: number | null;
  yearlyCost: Figure;
  /** Only for a regular-plan holding: its direct twin, or why none is shown. */
  direct: DirectPlan | { reason: Reason } | null;
};

/** `name` is null for holdings the site's data does not have. */
export type Slice = { name: string | null; value: number; share: number };

export type Checkup = {
  holdings: Holding[];
  redeemedCount: number;
  value: number;
  unvaluedCount: number;
  cost: Figure;
  gain: Figure;
  xirr: Figure;
  yearlyCost: { value: number; covered: number };
  directDifference: { value: number; count: number };
  categories: Slice[];
  subCategories: Slice[];
};

const UNITS_TOLERANCE = 0.0051;
const YEAR_DAYS = 365;

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const days = (from: string, to: string) => (Date.parse(to) - Date.parse(from)) / 86_400_000;

/** Cash in (negative) and out (positive) of the investor's pocket, as the statement prints it. */
function cashFlows(scheme: CasScheme): CashFlow[] {
  return scheme.transactions.flatMap((t): CashFlow[] => {
    switch (t.kind) {
      case "dividend_payout":
        return [{ date: t.date, amount: Math.abs(t.amount) }];
      case "stamp_duty":
      case "stt":
      case "tds":
        return [{ date: t.date, amount: -Math.abs(t.amount) }];
      // Reinvested payouts and bonus units bring no money in or out.
      case "dividend_reinvest":
      case "bonus":
        return [];
      default:
        return t.units ? [{ date: t.date, amount: -t.amount }] : [];
    }
  });
}

/** What was paid for the units still held, oldest units sold first. */
function heldCost(scheme: CasScheme): Figure {
  if (scheme.openingUnits > UNITS_TOLERANCE) return unknown("opening");
  const lots: { units: number; cost: number }[] = [];
  for (const t of scheme.transactions) {
    if (t.units > 0)
      lots.push({ units: t.units, cost: t.kind === "bonus" ? 0 : Math.abs(t.amount) });
    let out = t.units < 0 ? -t.units : 0;
    while (out > UNITS_TOLERANCE) {
      const lot = lots[0];
      if (!lot) return unknown("oversold");
      const used = Math.min(lot.units, out);
      lot.cost -= (lot.cost * used) / lot.units;
      lot.units -= used;
      out -= used;
      if (lot.units <= UNITS_TOLERANCE) lots.shift();
    }
  }
  return known(sum(lots.map((l) => l.cost)));
}

function rate(flows: CashFlow[], openingUnits: number[]): Figure {
  if (openingUnits.some((u) => u > UNITS_TOLERANCE)) return unknown("opening");
  const dates = flows.map((f) => f.date).sort();
  if (!dates.length) return unknown("noFlows");
  if (days(dates[0]!, dates.at(-1)!) < YEAR_DAYS) return unknown("underYear");
  const r = xirr(flows);
  return r === null ? unknown("noRate") : known(r);
}

function directTwin(row: Row, value: Figure, data: FundData): DirectPlan | { reason: Reason } {
  if (row.expense_ratio === null) return { reason: "noExpenseRatio" };
  const family = (row.fund_family_id && data.byFamily.get(row.fund_family_id)) || [];
  const direct = family.filter((r) => r.clean_plan === "Direct" && r.expense_ratio !== null);
  const twin = direct.find((r) => r.clean_option === row.clean_option) ?? direct[0];
  if (!twin)
    return {
      reason: family.some((r) => r.clean_plan === "Direct") ? "noDirectRatio" : "noDirectPlan",
    };
  const gap = row.expense_ratio - twin.expense_ratio!;
  return {
    schemeCode: twin.scheme_code!,
    name: twin.scheme_name!,
    expenseRatio: twin.expense_ratio!,
    difference: value.value === null ? value : known(value.value * gap),
  };
}

function slices(holdings: Holding[], pick: (h: Holding) => string | null): Slice[] {
  const totals = new Map<string | null, number>();
  for (const h of holdings)
    if (h.value.value !== null) {
      const name = pick(h);
      totals.set(name, (totals.get(name) ?? 0) + h.value.value);
    }
  const total = sum([...totals.values()]);
  return [...totals]
    .map(([name, value]) => ({ name, value, share: total ? value / total : 0 }))
    .sort((a, b) => b.value - a.value);
}

export function checkup(statement: CasStatement, data: FundData): Checkup {
  const groups = new Map<string, { row: Row | null; schemes: CasScheme[] }>();
  for (const scheme of statement.schemes) {
    const row = (scheme.isin && data.byIsin.get(scheme.isin)) || null;
    const key = row?.scheme_code ?? scheme.isin ?? `${scheme.amc}|${scheme.name}`;
    const group = groups.get(key) ?? { row, schemes: [] };
    group.schemes.push(scheme);
    groups.set(key, group);
  }

  const portfolioFlows: CashFlow[] = [];
  const holdings: Holding[] = [];
  let redeemedCount = 0;
  for (const [key, { row, schemes }] of groups) {
    const units = sum(schemes.map((s) => s.closingUnits));
    const flows = schemes.flatMap(cashFlows);
    portfolioFlows.push(...flows);
    if (units <= UNITS_TOLERANCE) {
      redeemedCount++;
      continue;
    }
    const statementValue = schemes.every((s) => s.valuation)
      ? schemes.map((s) => s.valuation!)
      : null;
    const nav: Holding["nav"] =
      row?.latest_nav != null && row.latest_nav_date
        ? { value: row.latest_nav, date: row.latest_nav_date, source: "site" }
        : statementValue
          ? { value: statementValue[0]!.nav, date: statementValue[0]!.date, source: "statement" }
          : null;
    const value: Figure =
      nav?.source === "site"
        ? known(units * nav.value)
        : statementValue
          ? known(sum(statementValue.map((v) => v.value)))
          : unknown("noValue");
    if (value.value !== null && nav) {
      flows.push({ date: nav.date, amount: value.value });
      portfolioFlows.push({ date: nav.date, amount: value.value });
    }
    const costs = schemes.map(heldCost);
    const cost = costs.find((c) => c.value === null) ?? known(sum(costs.map((c) => c.value!)));
    const expenseRatio = row?.expense_ratio ?? null;
    holdings.push({
      key,
      name: row?.scheme_name ?? schemes[0]!.name,
      schemeCode: row?.scheme_code ?? null,
      folios: schemes.map((s) => s.folio),
      units,
      nav,
      value,
      cost,
      gain:
        value.value === null ? value : cost.value === null ? cost : known(value.value - cost.value),
      xirr:
        value.value === null
          ? value
          : rate(
              flows,
              schemes.map((s) => s.openingUnits),
            ),
      category: row?.clean_category ?? null,
      subCategory: row?.clean_sub_category ?? null,
      plan: row?.clean_plan ?? null,
      expenseRatio,
      yearlyCost:
        expenseRatio === null
          ? unknown(row ? "noExpenseRatio" : "notInData")
          : value.value === null
            ? value
            : known(value.value * expenseRatio),
      direct: row?.clean_plan === "Regular" ? directTwin(row, value, data) : null,
    });
  }
  holdings.sort((a, b) => (b.value.value ?? -1) - (a.value.value ?? -1));

  const valued = holdings.filter((h) => h.value.value !== null);
  const value = sum(valued.map((h) => h.value.value!));
  const unvaluedCount = holdings.length - valued.length;
  const missingCost = holdings.find((h) => h.cost.value === null);
  const cost = missingCost
    ? unknown(missingCost.cost.reason!, missingCost.name)
    : known(sum(holdings.map((h) => h.cost.value!)));
  const missingValue = unvaluedCount ? unknown("incomplete") : null;
  const directs = holdings.flatMap((h) =>
    h.direct && "schemeCode" in h.direct && h.direct.difference.value !== null
      ? [h.direct.difference.value]
      : [],
  );
  return {
    holdings,
    redeemedCount,
    value,
    unvaluedCount,
    cost,
    gain: missingValue ?? (cost.value === null ? cost : known(value - cost.value)),
    xirr:
      missingValue ??
      rate(
        portfolioFlows,
        statement.schemes.map((s) => s.openingUnits),
      ),
    yearlyCost: {
      value: sum(holdings.map((h) => h.yearlyCost.value ?? 0)),
      covered: holdings.filter((h) => h.yearlyCost.value !== null).length,
    },
    directDifference: { value: sum(directs), count: directs.length },
    categories: slices(holdings, (h) => h.category),
    subCategories: slices(holdings, (h) => h.subCategory),
  };
}

export type StyleWeights = { schemeCode: string; weights: Map<string, number> };
export type StylePair = { a: string; b: string; overlap: number };

/**
 * Overlap of two estimated style mixes: the sum of the smaller weight on each index, so two
 * identical mixes are 100%. These are fitted from NAV movement, not holdings.
 */
export function styleOverlaps(funds: StyleWeights[], threshold: number): StylePair[] {
  const pairs: StylePair[] = [];
  funds.forEach((a, i) =>
    funds.slice(i + 1).forEach((b) => {
      const overlap = sum([...a.weights].map(([id, w]) => Math.min(w, b.weights.get(id) ?? 0)));
      if (overlap >= threshold) pairs.push({ a: a.schemeCode, b: b.schemeCode, overlap });
    }),
  );
  return pairs.sort((x, y) => y.overlap - x.overlap);
}
