/*
 * Ways the engine could be wrong, written before it was:
 *
 * Lot matching
 * - Sales matched LIFO, or across folios or schemes, instead of FIFO within one.
 * - A partial redemption that does not split a lot, or splits its cost by value not units.
 * - One sale spanning lots with different holding periods classified as one.
 * - A sale of more units than held producing a negative lot instead of an error.
 * - A same-day buy entered after the sale making the sale fail, or a sale using a
 *   same-day buy while older lots remain.
 * - Unit rounding in a statement leaving a phantom 0.0001-unit lot after a full exit.
 *
 * Dates
 * - The 12 (or 24, 36) months counted off by one: units bought on 1 Jan complete 12
 *   months on 31 Dec, so a sale on 1 Jan of the next year is long-term.
 * - A listed ETF judged on 24 months after 23 Jul 2024, when listed units need 12.
 * - A month-end purchase (29 Feb) overflowing into the wrong anniversary.
 * - A sale on 22 Jul 2024 taxed at the new rates, or one on 23 Jul 2024 at the old.
 * - Non-equity units sold before 23 Jul 2024 judged on 24 months instead of 36.
 * - A debt purchase on 31 Mar 2023 caught by section 50AA, or one on 1 Apr 2023 missed.
 * - Gold or international units bought after Apr 2023 still deemed short-term after the
 *   Finance Act 2025 narrowed the definition, or hybrids deemed short-term at all.
 * - A sale on 31 Mar landing in the next financial year.
 *
 * Grandfathering
 * - Applied to non-equity funds, or to units bought on or after 1 Feb 2018.
 * - The 31 Jan 2018 value used outright instead of capped at the sale value, turning a
 *   gain into a loss; or used when below cost, hiding a real loss.
 * - A missing 31 Jan 2018 NAV silently replaced by actual cost.
 *
 * Tax
 * - The 1.25 lakh exemption applied per rate window instead of once for FY 2024-25, or
 *   to the 10% gains first.
 * - A long-term loss set off against a short-term gain; losses set off after the exemption.
 * - Indexation applied after 23 Jul 2024 or to equity funds.
 * - Cess left out, or slab-rate tax invented without a slab rate.
 *
 * Switches and statements
 * - A switch-in dated from the source fund's purchase instead of the switch.
 * - Redemptions read with the statement's negative sign; stamp duty read as units; bonus
 *   units given a cost; a merger or an opening balance matched as if lots were known.
 */
import { describe, expect, it } from "vitest";
import { tradesFromCas } from "./cas";
import { computeGains, type Holding, type Trade } from "./engine";
import { classify, longTermFrom, type FundType } from "./rules";

const buy = (date: string, units: number, amount: number): Trade => ({
  date,
  side: "buy",
  units,
  amount,
});
const sell = (date: string, units: number, amount: number): Trade => ({
  date,
  side: "sell",
  units,
  amount,
});
const holding = (type: FundType, trades: Trade[], extra: Partial<Holding> = {}): Holding => ({
  id: extra.name ?? type,
  name: type,
  type,
  listed: false,
  nav31Jan2018: null,
  trades,
  latest: null,
  ...extra,
});

function run(holdings: Holding[], slabRate: number | null = null, asOf = "2026-11-02") {
  const result = computeGains(holdings, { asOf, slabRate });
  if (!result.ok) throw new Error(JSON.stringify(result.errors));
  return result;
}

describe("FIFO matching", () => {
  it("splits a sale across lots by units and classifies each lot on its own dates", () => {
    // 150 units sold: the first lot's 100 (held 13+ months, long) then 50 of the second
    // (under 9 months, short) at cost 50/100 x 8,000 = 4,000 against 50 x 120 = 6,000.
    const r = run([
      holding("equity", [
        buy("2022-01-10", 100, 10_000),
        buy("2022-06-10", 100, 8_000),
        sell("2023-03-01", 150, 18_000),
      ]),
    ]);
    expect(r.realised.map((l) => [l.bought, l.units, l.cost, l.proceeds, l.head.section])).toEqual([
      ["2022-01-10", 100, 10_000, 12_000, "112A"],
      ["2022-06-10", 50, 4_000, 6_000, "111A"],
    ]);
    // The 50 left keep their own date and the other half of the cost.
    expect(r.open.map((l) => [l.bought, l.units, l.cost])).toEqual([["2022-06-10", 50, 4_000]]);
    // FY 2022-23: STCG 2,000 x 15% = 300; LTCG 2,000 inside the 1 lakh exemption.
    const [fy] = r.years;
    expect(fy).toMatchObject({
      fyStart: 2022,
      shortTerm: 2_000,
      longTerm: 2_000,
      exemptionUsed: 2_000,
    });
    expect(fy!.total).toBeCloseTo(312);
  });

  it("never matches across holdings", () => {
    const r = computeGains(
      [
        holding("equity", [buy("2022-01-10", 10, 100)], { name: "A" }),
        holding("equity", [sell("2023-03-01", 5, 60)], { name: "B" }),
      ],
      { asOf: "2026-11-02", slabRate: null },
    );
    expect(r).toEqual({
      ok: false,
      errors: [{ problem: "oversold", fund: "B", date: "2023-03-01", units: 5, held: 0 }],
    });
  });

  it("refuses a sale larger than the units held but absorbs statement rounding", () => {
    const over = computeGains(
      [holding("equity", [buy("2022-01-10", 10, 100), sell("2023-03-01", 10.01, 120)])],
      {
        asOf: "2026-11-02",
        slabRate: null,
      },
    );
    expect(over.ok).toBe(false);
    // Three buys of 33.3333 units are 99.9999; a full exit printed as 100 empties them.
    const r = run([
      holding("equity", [
        buy("2022-01-10", 33.3333, 1000),
        buy("2022-02-10", 33.3333, 1000),
        buy("2022-03-10", 33.3333, 1000),
        sell("2023-06-01", 100, 3600),
      ]),
    ]);
    expect(r.open).toEqual([]);
    expect(r.realised).toHaveLength(3);
  });

  it("lets a sale use a same-day buy whatever order they were entered in", () => {
    const r = run([holding("equity", [sell("2024-03-01", 10, 1000), buy("2024-03-01", 10, 1000)])]);
    expect(r.realised).toHaveLength(1);
  });
});

describe("holding period boundaries", () => {
  it("counts 12 months as Bharti Gupta Ramola does, and a 29 Feb purchase to 28 Feb", () => {
    // Bought 10 Jan 2023: 12 months complete on 9 Jan 2024, so 10 Jan is long-term.
    expect(classify("equity", "2023-01-10", "2024-01-09").term).toBe("short");
    expect(classify("equity", "2023-01-10", "2024-01-10").term).toBe("long");
    expect(classify("equity", "2024-02-29", "2025-02-28").term).toBe("short");
    expect(classify("equity", "2024-02-29", "2025-03-01").term).toBe("long");
  });

  it("switches equity rates on sales from 23 Jul 2024", () => {
    expect(classify("equity", "2024-01-01", "2024-07-22")).toMatchObject({
      section: "111A",
      rate: 0.15,
    });
    expect(classify("equity", "2024-01-01", "2024-07-23")).toMatchObject({
      section: "111A",
      rate: 0.2,
    });
    expect(classify("equity", "2022-01-01", "2024-07-22")).toMatchObject({
      section: "112A",
      rate: 0.1,
    });
    expect(classify("equity", "2022-01-01", "2024-07-23")).toMatchObject({
      section: "112A",
      rate: 0.125,
    });
  });

  it("uses 36 months for non-equity sales before 23 Jul 2024 and 24 from that day", () => {
    // Bought 1 Aug 2021: 35 months on 22 Jul 2024 is short; 23 Jul is past 24 months.
    expect(classify("debt", "2021-08-01", "2024-07-22")).toMatchObject({
      section: "slab",
      specified: false,
    });
    expect(classify("debt", "2021-08-01", "2024-07-23")).toMatchObject({
      section: "112",
      rate: 0.125,
      indexed: false,
    });
    expect(classify("debt", "2021-07-01", "2024-06-30").term).toBe("short");
    expect(classify("debt", "2021-07-01", "2024-07-01")).toMatchObject({
      section: "112",
      rate: 0.2,
      indexed: true,
    });
  });

  it("gives listed units 12 months from 23 Jul 2024 but 36 before", () => {
    // A gold ETF bought Jan 2024 and sold Jun 2025, 17 months on: long-term only listed.
    expect(classify("other", "2024-01-01", "2025-06-01", true)).toMatchObject({
      section: "112",
      rate: 0.125,
    });
    expect(classify("other", "2024-01-01", "2025-06-01").term).toBe("short");
    expect(classify("other", "2020-01-01", "2022-06-01", true).term).toBe("short");
    // A debt ETF bought from Apr 2023 is a specified fund's unit, listed or not.
    expect(classify("debt", "2023-05-01", "2025-06-01", true)).toMatchObject({ section: "slab" });
  });

  it("indexes non-equity cost for sales before 23 Jul 2024", () => {
    // CII 317 (FY 2021-22) to 363 (FY 2024-25): 10,000 x 363/317 = 11,451.10, so 12,000
    // of proceeds is a gain of 548.90, taxed at 20% = 109.78 plus 4% cess = 114.17.
    const r = run([
      holding("debt", [buy("2021-07-01", 100, 10_000), sell("2024-07-02", 100, 12_000)]),
    ]);
    expect(r.realised[0]!.taxCost).toBeCloseTo(11_451.1, 1);
    expect(r.years[0]!.total).toBeCloseTo(114.17, 1);
  });

  it("deems specified fund units bought from 1 Apr 2023 short-term", () => {
    expect(classify("debt", "2023-03-31", "2025-04-01")).toMatchObject({
      section: "112",
      rate: 0.125,
    });
    expect(classify("debt", "2023-04-01", "2026-04-02")).toMatchObject({
      section: "slab",
      specified: true,
    });
    // Gold under the 2023 definition until 31 Mar 2025, then judged on 24 months.
    expect(classify("other", "2023-05-02", "2025-03-03")).toMatchObject({
      section: "slab",
      specified: true,
    });
    expect(classify("other", "2023-05-02", "2025-04-15")).toMatchObject({
      section: "slab",
      specified: false,
    });
    expect(classify("other", "2023-05-02", "2025-06-03")).toMatchObject({
      section: "112",
      rate: 0.125,
    });
    expect(classify("hybrid", "2023-05-02", "2025-03-03")).toMatchObject({
      section: "slab",
      specified: false,
    });
    expect(classify("hybrid", "2023-05-02", "2025-06-03")).toMatchObject({
      section: "112",
      rate: 0.125,
    });
  });

  it("puts a sale on 31 Mar and one on 1 Apr in different years", () => {
    const r = run([
      holding("equity", [
        buy("2020-01-01", 2, 200),
        sell("2024-03-31", 1, 150),
        sell("2024-04-01", 1, 150),
      ]),
    ]);
    expect(r.years.map((y) => y.fyStart)).toEqual([2024, 2023]);
  });
});

describe("grandfathering of equity bought before 1 Feb 2018", () => {
  const gf = (proceeds: number, fmv: number | null, bought = "2017-06-01") =>
    run([
      holding("equity", [buy(bought, 100, 10_000), sell("2019-06-01", 100, proceeds)], {
        nav31Jan2018: fmv,
      }),
    ]).realised[0]!;

  it("takes the higher of cost and the lower of the 31 Jan 2018 value and the sale", () => {
    // max(10,000, min(15,000, 20,000)) = 15,000
    expect(gf(20_000, 150).gain).toBe(5_000);
    // max(10,000, min(15,000, 12,000)) = 12,000: the cap keeps it from becoming a loss.
    expect(gf(12_000, 150).gain).toBe(0);
    // max(10,000, min(8,000, 9,000)) = 10,000: a real loss stays a loss.
    expect(gf(9_000, 80).gain).toBe(-1_000);
    expect(gf(20_000, 150, "2018-01-31").gain).toBe(5_000);
    expect(gf(20_000, 150, "2018-02-01").gain).toBe(10_000);
  });

  it("leaves the gain out and the year incomplete without a 31 Jan 2018 NAV", () => {
    const r = run([
      holding("equity", [buy("2017-06-01", 100, 10_000), sell("2019-06-01", 100, 20_000)]),
    ]);
    expect(r.realised[0]!.needsNav31Jan2018).toBe(true);
    expect(r.years[0]).toMatchObject({ complete: false, longTerm: 0 });
  });

  it("does not grandfather non-equity funds", () => {
    const r = run([
      holding("debt", [buy("2017-06-01", 100, 10_000), sell("2023-06-01", 100, 20_000)], {
        nav31Jan2018: 150,
      }),
    ]);
    // Indexed instead: 10,000 x 348/272 = 12,794.12.
    expect(r.realised[0]!.taxCost).toBeCloseTo(12_794.12, 1);
  });

  it("does not tax sales before FY 2018-19", () => {
    const r = run([
      holding("equity", [buy("2016-01-01", 10, 1_000), sell("2018-03-01", 10, 2_000)]),
    ]);
    expect(r.years[0]).toMatchObject({ fyStart: 2017, covered: false, total: null, buckets: [] });
  });
});

describe("exemption, set-off and tax", () => {
  it("applies one 1.25 lakh exemption across FY 2024-25, to the 12.5% gains first", () => {
    // 80,000 at 10% (before 23 Jul) and 100,000 at 12.5% (after). The 12.5% gains are
    // fully exempt, leaving 25,000 for the 10% ones: 55,000 x 10% = 5,500 + 4% = 5,720.
    const r = run([
      holding("equity", [buy("2022-01-01", 100, 100_000), sell("2024-06-03", 100, 180_000)], {
        name: "A",
      }),
      holding("equity", [buy("2022-01-01", 100, 100_000), sell("2024-09-02", 100, 200_000)], {
        name: "B",
      }),
    ]);
    expect(r.years[0]).toMatchObject({ exemptionLimit: 125_000, exemptionUsed: 125_000 });
    expect(r.years[0]!.total).toBeCloseTo(5_720);
  });

  it("allows 1 lakh before FY 2024-25", () => {
    // 150,000 - 100,000 = 50,000 at 10% = 5,000 + 4% = 5,200.
    const r = run([
      holding("equity", [buy("2021-01-01", 100, 100_000), sell("2023-06-01", 100, 250_000)]),
    ]);
    expect(r.years[0]!.total).toBeCloseTo(5_200);
  });

  it("sets a short-term loss off against the highest rate before the exemption", () => {
    // ST loss 30,000 meets the 50,000 slab gain first (30% beats 12.5%): 20,000 x 30% =
    // 6,000. LTCG 200,000 - 125,000 = 75,000 x 12.5% = 9,375. 15,375 + 4% = 15,990.
    const r = run(
      [
        holding("equity", [buy("2025-05-01", 1000, 100_000), sell("2025-09-01", 1000, 70_000)], {
          name: "A",
        }),
        holding("equity", [buy("2023-01-02", 1000, 100_000), sell("2025-09-01", 1000, 300_000)], {
          name: "B",
        }),
        holding("debt", [buy("2024-01-02", 1000, 100_000), sell("2025-09-01", 1000, 150_000)], {
          name: "C",
        }),
      ],
      0.3,
    );
    expect(r.years[0]).toMatchObject({ slabGain: 20_000, slabTax: 6_000, specialTax: 9_375 });
    expect(r.years[0]!.total).toBeCloseTo(15_990);
  });

  it("keeps a long-term loss away from short-term gains and slab tax unknown without a rate", () => {
    const r = run([
      holding("equity", [buy("2023-01-02", 1000, 100_000), sell("2025-09-01", 1000, 90_000)], {
        name: "A",
      }),
      holding("debt", [buy("2024-01-02", 1000, 100_000), sell("2025-09-01", 1000, 150_000)], {
        name: "C",
      }),
    ]);
    expect(r.years[0]).toMatchObject({
      slabGain: 50_000,
      slabTax: null,
      total: null,
      specialTax: 0,
    });
  });
});

describe("switches and statements", () => {
  const scheme = (
    transactions: { date: string; kind: string; units: number; amount: number }[],
    openingUnits = 0,
  ) => ({
    name: "S",
    amc: "A",
    folio: "1",
    isin: null,
    amfiCode: null,
    openingUnits,
    closingUnits: 0,
    valuation: null,
    transactions: transactions.map((t) => ({ ...t, nav: null, description: "" })) as never,
  });

  it("dates a switch-in from the switch, not the source fund's purchase", () => {
    const out = tradesFromCas(
      scheme([
        { date: "2020-01-01", kind: "purchase", units: 100, amount: 10_000 },
        { date: "2025-01-10", kind: "switch_out", units: -100, amount: -30_000 },
        { date: "2025-01-10", kind: "stamp_duty", units: 0, amount: 0.5 },
      ]),
    );
    const into = tradesFromCas(
      scheme([
        { date: "2025-01-10", kind: "switch_in", units: 300, amount: 30_000 },
        { date: "2025-06-10", kind: "redemption", units: -300, amount: -33_000 },
      ]),
    );
    if (!("trades" in out) || !("trades" in into)) throw new Error("unsupported");
    const r = run([
      holding("equity", out.trades, { name: "A" }),
      holding("equity", into.trades, { name: "B" }),
    ]);
    // A: 20,000 long-term at 12.5%. B: held five months, 3,000 short-term at 20%.
    expect(r.realised.map((l) => [l.head.section, l.gain])).toEqual([
      ["112A", 20_000],
      ["111A", 3_000],
    ]);
  });

  it("gives bonus units no cost and refuses lots it cannot know", () => {
    const bonus = tradesFromCas(
      scheme([{ date: "2024-01-01", kind: "bonus", units: 10, amount: 100 }]),
    );
    expect(bonus).toEqual({ trades: [buy("2024-01-01", 10, 0)] });
    expect(tradesFromCas(scheme([], 5))).toHaveProperty("unsupported");
    expect(
      tradesFromCas(scheme([{ date: "2024-01-01", kind: "merger_in", units: 10, amount: 100 }])),
    ).toHaveProperty("unsupported");
  });
});

describe("unrealised view", () => {
  it("shows each lot's status today and the exemption left this year", () => {
    const r = run([
      holding(
        "equity",
        [
          buy("2026-01-15", 10, 1_000),
          buy("2023-01-02", 100, 10_000),
          sell("2026-05-04", 100, 50_000),
        ],
        {
          name: "E",
          latest: { date: "2026-10-30", nav: 150 },
        },
      ),
      holding("debt", [buy("2023-06-01", 10, 1_000)], { name: "D" }),
      holding("other", [buy("2023-06-01", 10, 1_000)], { name: "G" }),
    ]);
    expect(r.open.map((l) => [l.holdingId, l.head.term, l.longTermFrom, l.gain])).toEqual([
      ["E", "short", "2027-01-15", 500],
      ["D", "short", null, null],
      ["G", "long", "2025-06-01", null],
    ]);
    // 40,000 of equity LTCG this year leaves 125,000 - 40,000.
    expect(r.exemptionLeft).toEqual({ fyStart: 2026, limit: 125_000, left: 85_000 });
  });

  it("knows gold bought after Apr 2023 could not turn long-term before Apr 2025", () => {
    expect(longTermFrom("other", "2023-06-01", "2025-01-01")).toBeNull();
  });
});
