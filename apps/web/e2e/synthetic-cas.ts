/**
 * A synthetic CAMS detailed CAS, laid out the way the real statement is: a two-baseline
 * transaction header, right-aligned figures, a scheme header wrapped over two lines, a
 * description wrapped below its row, stamp duty rows and a closing footer. The funds are
 * taken from public/data so the join to the site's data is exercised.
 */
import { PDFDocument, StandardFonts, type PDFFont, type PDFPage } from "pdf-lib";
import { siteData } from "./site-data";

const column = (name: string): unknown[] => {
  const raw = siteData(`screen/${name}.json`) as
    unknown[] | { rows: number[]; distinct: unknown[] };
  return Array.isArray(raw) ? raw : raw.rows.map((i: number) => raw.distinct[i]);
};

export type Fund = {
  code: string;
  name: string;
  isin: string;
  nav: number;
  expenseRatio: number;
};

const styled = (code: string) => {
  try {
    const bundle = siteData(`fund/${code}.json`) as {
      exposure?: { reason: string | null; weights: unknown[] };
    };
    return bundle.exposure?.reason === null && bundle.exposure.weights.length > 0;
  } catch {
    return false;
  }
};

/** A regular growth plan and its direct growth twin, both with an expense ratio and a style fit. */
export function pickFunds(): { regular: Fund; direct: Fund } {
  const c = Object.fromEntries(
    [
      "scheme_code",
      "scheme_name",
      "isin_growth",
      "latest_nav",
      "expense_ratio",
      "clean_plan",
      "clean_option",
      "fund_family_id",
    ].map((n) => [n, column(n)]),
  );
  const fund = (i: number): Fund => ({
    code: c.scheme_code![i] as string,
    name: c.scheme_name![i] as string,
    isin: c.isin_growth![i] as string,
    nav: c.latest_nav![i] as number,
    expenseRatio: c.expense_ratio![i] as number,
  });
  const usable = (i: number, plan: string) =>
    c.clean_plan![i] === plan &&
    c.clean_option![i] === "Growth" &&
    c.expense_ratio![i] != null &&
    c.latest_nav![i] != null &&
    /^INF[0-9A-Z]{8}\d$/.test(String(c.isin_growth![i])) &&
    // Short enough to fit the statement's header line on an A4 page.
    String(c.scheme_name![i]).length < 70;
  const isins = column("isin_growth");
  const unique = (i: number) => isins.indexOf(isins[i]) === isins.lastIndexOf(isins[i]);
  for (let i = 0; i < c.scheme_code!.length; i++) {
    if (!usable(i, "Regular") || !unique(i)) continue;
    const j = c.fund_family_id!.findIndex(
      (f, k) => f === c.fund_family_id![i] && usable(k, "Direct") && unique(k),
    );
    if (j < 0 || (c.expense_ratio![i] as number) <= (c.expense_ratio![j] as number)) continue;
    if (styled(c.scheme_code![i] as string) && styled(c.scheme_code![j] as string))
      return { regular: fund(i), direct: fund(j) };
  }
  throw new Error("No regular/direct pair with expense ratios and style fits in the site data");
}

type Txn = { date: string; description: string[]; amount?: number; nav?: number; tax?: number };
type Scheme = {
  code: string;
  name: string;
  isin: string;
  /** Wrap the advisor and registrar onto a second header line. */
  wrapHeader: boolean;
  txns: Txn[];
  closingNav: number;
};

export type Expected = { name: string; isin: string; units: number; amounts: number[] };

const inr = (v: number) =>
  `${v < 0 ? "(" : ""}${Math.abs(v).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}${v < 0 ? ")" : ""}`;
const fixed = (v: number, d: number) =>
  `${v < 0 ? "(" : ""}${Math.abs(v).toLocaleString("en-IN", { minimumFractionDigits: d, maximumFractionDigits: d })}${v < 0 ? ")" : ""}`;
const round3 = (v: number) => Math.round(v * 1000) / 1000;

export const CLOSED_FUND = {
  name: "Example Fixed Term Plan - Series 7 - Regular Plan - Growth",
  isin: "INF000Z01019",
  invested: 10_000,
};

export async function buildCas(funds: { regular: Fund; direct: Fund }) {
  const { regular, direct } = funds;
  // Hand-checkable: 9,999.50 plus 0.50 stamp duty paid on 15-Oct-2025, worth 11,000.00 on
  // 15-Oct-2026, 365 days later, is an XIRR of exactly 10%.
  const schemes: Scheme[] = [
    {
      code: "B03G",
      name: regular.name,
      isin: regular.isin,
      wrapHeader: true,
      closingNav: regular.nav,
      txns: [
        {
          date: "10-Jan-2022",
          description: ["SIP Purchase - Instalment 1/36"],
          amount: 4999.75,
          nav: 412.37,
          tax: 0.25,
        },
        {
          date: "10-Feb-2022",
          description: ["SIP Purchase - Instalment 2/36"],
          amount: 4999.75,
          nav: 398.12,
          tax: 0.25,
        },
        {
          date: "10-Mar-2022",
          description: ["SIP Purchase - Instalment 3/36"],
          amount: 4999.75,
          nav: 381.9,
          tax: 0.25,
        },
        {
          date: "17-Apr-2023",
          description: ["Redemption - ELECTRONIC PAYMENT"],
          amount: -3000,
          nav: 455.6,
          tax: 0.02,
        },
        {
          date: "05-Jun-2024",
          description: ["Switch-Out - To Direct Plan Growth"],
          amount: -2500,
          nav: 520.25,
        },
      ],
    },
    {
      code: "B03GD",
      name: direct.name,
      isin: direct.isin,
      wrapHeader: false,
      closingNav: direct.nav,
      txns: [
        {
          date: "05-Jun-2024",
          description: ["Switch-In - From Regular Plan Growth"],
          amount: 2500,
          nav: 560.1,
        },
        {
          date: "12-Aug-2024",
          description: ["Purchase - via Internet - Additional", "Purchase Systematic"],
          amount: 19999,
          nav: 571.44,
          tax: 1,
        },
      ],
    },
    {
      code: "X7RG",
      name: CLOSED_FUND.name,
      isin: CLOSED_FUND.isin,
      wrapHeader: false,
      closingNav: 11,
      txns: [
        { date: "15-Oct-2025", description: ["Purchase"], amount: 9999.5, nav: 9.9995, tax: 0.5 },
      ],
    },
  ];

  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const size = 7.5;
  const step = 11;
  let page: PDFPage = doc.addPage([595, 842]);
  let y = 800;
  const text = (s: string, x: number, f: PDFFont = font, at = y, sz = size) =>
    page.drawText(s, { x, y: at, size: sz, font: f });
  const right = (s: string, edge: number) => text(s, edge - font.widthOfTextAtSize(s, size), font);
  const COL = { date: 30, txn: 85, amount: 360, units: 425, price: 485, balance: 560 };
  const tableHeader = () => {
    text("Date", COL.date, bold);
    text("Transaction", COL.txn, bold);
    for (const [label, edge] of [
      ["Amount", COL.amount],
      ["Units", COL.units],
      ["Price", COL.price],
      ["Unit", COL.balance],
    ] as const)
      text(label, edge - bold.widthOfTextAtSize(label, size), bold);
    y -= 9;
    for (const [label, edge] of [
      ["(INR)", COL.amount],
      ["(INR)", COL.price],
      ["Balance", COL.balance],
    ] as const)
      text(label, edge - bold.widthOfTextAtSize(label, size), bold);
    y -= step + 4;
  };
  const newline = (n = 1) => {
    y -= step * n;
    if (y < 60) {
      page = doc.addPage([595, 842]);
      y = 800;
      tableHeader();
    }
  };

  text("Consolidated Account Statement", 200, bold, y, 12);
  newline(2);
  text("01-Jan-1990 To 15-Oct-2026", 240);
  newline(2);
  text("Email Id: asha.verma@example.com", 30);
  newline();
  text("ASHA VERMA", 30);
  newline();
  text("14 Lake View Road, Bengaluru 560001", 30);
  newline();
  text("Mobile: +919800000000", 30);
  newline(2);
  text("PORTFOLIO SUMMARY", 30, bold);
  newline();
  // A summary row ends in an AMC's name too, but carries figures, so it is not a section.
  text("Aditya Birla Sun Life Mutual Fund", 30);
  right("1,00,000.00", 400);
  right("1,20,000.00", 500);
  newline(2);
  tableHeader();

  const expected: Expected[] = [];
  for (const [index, s] of schemes.entries()) {
    if (index === 0 || index === 2) {
      text(index === 0 ? "Example Mutual Fund" : "Closed Schemes Mutual Fund", 30, bold);
      newline();
      text(`Folio No: ${index === 0 ? "1040212345 / 0" : "7788990011"}`, 30);
      text("PAN: ABCPV1234K", 200);
      text("KYC: OK  PAN: OK", 300);
      newline();
      text("ASHA VERMA", 30);
      newline();
    }
    if (s.wrapHeader) {
      text(`${s.code}-${s.name} - ISIN: ${s.isin}`, 30);
      newline();
      text("(Advisor: ARN-12345)", 30);
      text("Registrar : CAMS", 470);
    } else {
      text(`${s.code}-${s.name} - ISIN: ${s.isin}(Advisor: DIRECT)`, 30);
      text("Registrar : CAMS", 470);
    }
    newline();
    text("Nominee 1: RAHUL VERMA", 30);
    text("Nominee 2:", 200);
    text("Nominee 3:", 330);
    newline();
    text("Opening Unit Balance: 0.000", 30, bold);
    newline();
    let balance = 0;
    const amounts: number[] = [];
    for (const t of s.txns) {
      const units = round3(t.amount! / t.nav!);
      balance = round3(balance + units);
      amounts.push(t.amount!);
      text(t.date, COL.date);
      text(t.description[0]!, COL.txn);
      right(inr(t.amount!), COL.amount);
      right(fixed(units, 3), COL.units);
      right(fixed(t.nav!, 4), COL.price);
      right(fixed(balance, 3), COL.balance);
      for (const more of t.description.slice(1)) {
        y -= 8;
        text(more, COL.txn);
      }
      newline();
      if (t.tax) {
        text(t.date, COL.date);
        text(t.amount! > 0 ? "*** Stamp Duty ***" : "*** STT Paid ***", COL.txn);
        right(inr(t.tax), COL.amount);
        newline();
      }
    }
    const value = Math.round(balance * s.closingNav * 100) / 100;
    text(`Closing Unit Balance: ${fixed(balance, 3)}`, 30, bold);
    text(`NAV on 15-Oct-2026: INR ${fixed(s.closingNav, 4)}`, 230);
    newline();
    text(`Total Cost Value: ${inr(s.txns.reduce((a, t) => a + Math.max(t.amount!, 0), 0))}`, 30);
    text(`Market Value on 15-Oct-2026: INR ${inr(value)}`, 230);
    newline(2);
    expected.push({ name: s.name, isin: s.isin, units: balance, amounts });
  }
  return { pdf: await doc.save(), expected };
}

/** A PDF that opens fine and is not a statement. */
export async function buildOtherPdf() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  doc
    .addPage([595, 842])
    .drawText("Tax invoice 2026-114 for consulting services", { x: 50, y: 780, size: 12, font });
  return doc.save();
}
