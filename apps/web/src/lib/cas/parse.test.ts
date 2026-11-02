// Layouts from casparser's documented cases that the E2E statement does not reach: a
// registrar label pushed above a long scheme name, a KFintech reversed row printed with the
// wrong sign, rows read without a column header, and the statements that must be refused.
import { describe, expect, it } from "vitest";
import { CasFormatError, parseCasLines, type Cell, type Line } from "./parse";

const left = (x0: number, text: string): Cell => ({ text, x0, x1: x0 + text.length * 4 });
const right = (x1: number, text: string): Cell => ({ text, x0: x1 - text.length * 4, x1 });

let y = 800;
const line = (...cells: Cell[]): Line => ({ page: 1, y: (y -= 12), height: 8, cells });
const row = (date: string, description: string, ...figures: string[]) =>
  line(
    left(30, date),
    left(85, description),
    ...figures.map((f, i) => right([360, 425, 485, 560][i]!, f)),
  );

const statement = (body: Line[], header = true): Line[] => {
  y = 800;
  return [
    line(left(200, "Consolidated Account Statement")),
    line(left(240, "01-Jan-2024 To 30-Jun-2024")),
    ...(header
      ? [
          line(
            left(30, "Date"),
            left(85, "Transaction"),
            right(360, "Amount"),
            right(425, "Units"),
            right(485, "Price"),
            right(560, "Unit"),
          ),
          line(right(360, "(INR)"), right(485, "(INR)"), right(560, "Balance")),
        ]
      : []),
    line(left(30, "Test Mutual Fund")),
    line(left(30, "Folio No: 12345 / 67"), left(200, "PAN: ABCDE1234F")),
    ...body,
  ];
};

describe("parseCasLines", () => {
  it("reads a scheme whose registrar label sits on the line above its name", () => {
    const { schemes } = parseCasLines(
      statement([
        line(left(470, "Registrar : KFINTECH")),
        line(
          left(
            30,
            "T123-Test Long Duration Fund - Direct Growth (formerly Old Name) - ISIN: INF123A01234",
          ),
        ),
        line(left(30, "Opening Unit Balance: 0.000")),
        row("01-Jan-2024", "Purchase", "1,000.00", "10.000", "100.0000", "10.000"),
        line(
          left(30, "Closing Unit Balance: 10.000"),
          left(230, "NAV on 30-Jun-2024: INR 101.5000"),
        ),
        line(left(230, "Market Value on 30-Jun-2024: INR 1,015.00")),
      ]),
    );
    expect(schemes).toEqual([
      expect.objectContaining({
        name: "Test Long Duration Fund - Direct Growth",
        isin: "INF123A01234",
        folio: "12345 / 67",
        amc: "Test Mutual Fund",
        closingUnits: 10,
        valuation: { date: "2024-06-30", nav: 101.5, value: 1015 },
      }),
    ]);
  });

  it("trusts the printed unit balance over a reversed row's parentheses", () => {
    const { schemes } = parseCasLines(
      statement([
        line(left(30, "K9-Test Fund - Growth Registrar : KFINTECH")),
        line(left(30, "Opening Unit Balance: 0.000")),
        row("01-Jan-2024", "Purchase", "1,000.00", "10.000", "100.0000", "10.000"),
        row("02-Jan-2024", "Redemption", "(500.00)", "(5.000)", "100.0000", "5.000"),
        row(
          "03-Jan-2024",
          "Units Extinguished-Reversed",
          "(200.00)",
          "(2.000)",
          "100.0000",
          "7.000",
        ),
        line(left(30, "Closing Unit Balance: 7.000")),
      ]),
    );
    expect(schemes[0]!.transactions.map((t) => [t.kind, t.units, t.amount])).toEqual([
      ["purchase", 10, 1000],
      ["redemption", -5, -500],
      ["purchase", 2, 200],
    ]);
  });

  it("places figures by count when no column header was read", () => {
    const { schemes } = parseCasLines(
      statement(
        [
          line(left(30, "D1-Test Fund - IDCW Registrar : CAMS")),
          line(left(30, "Opening Unit Balance: 10.000")),
          row(
            "01-Feb-2024",
            "IDCW Reinvestment @ Rs.2.00 per unit",
            "20.00",
            "0.200",
            "100.0000",
            "10.200",
          ),
          row("01-Mar-2024", "IDCW Paid @ Rs.2.00 per unit", "20.40"),
          row("05-Mar-2024", "*** TDS on above ***", "2.04"),
          row(
            "10-Mar-2024",
            "S T P Out (to Test Liquid Fund)",
            "(102.00)",
            "(1.000)",
            "102.0000",
            "9.200",
          ),
          line(left(30, "Closing Unit Balance: 9.200")),
        ],
        false,
      ),
    );
    expect(schemes[0]!.transactions.map((t) => [t.kind, t.units, t.amount])).toEqual([
      ["dividend_reinvest", 0.2, 20],
      ["dividend_payout", 0, 20.4],
      ["tds", 0, 2.04],
      ["switch_out", -1, -102],
    ]);
  });

  it("refuses a row it misread rather than value the scheme wrongly", () => {
    expect(() =>
      parseCasLines(
        statement([
          line(left(30, "T1-Test Fund - Growth Registrar : CAMS")),
          line(left(30, "Opening Unit Balance: 0.000")),
          row("01-Jan-2024", "Purchase", "1,000.00", "10.000", "100.0000", "10.000"),
          line(left(30, "Closing Unit Balance: 15.000")),
        ]),
      ),
    ).toThrow(/do not add up/);
  });

  it.each([
    [[line(left(30, "NSDL Consolidated Account Statement"))], "demat"],
    [
      [line(left(30, "Consolidated Account Summary")), line(left(30, "As on 30-Jun-2024"))],
      "summary",
    ],
    [[line(left(30, "Tax invoice"))], "not_cas"],
  ])("refuses a statement it cannot read faithfully (%#)", (lines, reason) => {
    expect(() => parseCasLines(lines)).toThrow(expect.objectContaining({ reason }));
    expect(() => parseCasLines(lines)).toThrow(CasFormatError);
  });
});
