/**
 * Reads a CAMS/KFintech detailed Consolidated Account Statement in the browser.
 *
 * The layout rules and regular expressions are ported from casparser by Sandeep Somasekharan
 * (MIT, https://github.com/codereverser/casparser): the folio and scheme-header patterns, the
 * balance and valuation lines, the transaction classifier and the running-balance sign fix.
 * casparser reads character positions with pdfium; here pdf.js text runs are grouped into
 * lines and cells, and numeric cells are placed by the transaction table's column headers.
 */
import type { CasScheme, CasStatement, CasTransaction, CasTransactionKind, IsoDate } from "./types";

/** The PDF is encrypted and no password, or the wrong one, was given. */
export class CasPasswordError extends Error {
  constructor(readonly incorrect: boolean) {
    super(
      incorrect
        ? "That password did not open the statement."
        : "This statement needs its password.",
    );
    this.name = "CasPasswordError";
  }
}

export type CasFormatReason = "not_pdf" | "not_cas" | "demat" | "summary" | "layout";

/** Opened, but not a statement this parser can read faithfully. */
export class CasFormatError extends Error {
  constructor(
    readonly reason: CasFormatReason,
    message: string,
  ) {
    super(message);
    this.name = "CasFormatError";
  }
}

export type Cell = { text: string; x0: number; x1: number };
export type Line = { page: number; y: number; height: number; cells: Cell[] };

export async function parseCas(file: File | ArrayBuffer, password?: string): Promise<CasStatement> {
  return parseCasLines(await extractLines(file, password));
}

async function extractLines(file: File | ArrayBuffer, password?: string): Promise<Line[]> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url,
  ).toString();
  // pdf.js transfers the buffer to its worker, so a caller's ArrayBuffer is copied to stay
  // usable for a retry with a password.
  const data = new Uint8Array(
    file instanceof ArrayBuffer ? file.slice(0) : await file.arrayBuffer(),
  );
  const task = pdfjs.getDocument({ data, password });
  try {
    const doc = await task.promise;
    const lines: Line[] = [];
    for (let page = 1; page <= doc.numPages; page++) {
      const content = await (await doc.getPage(page)).getTextContent();
      const runs = content.items
        .flatMap((item) => ("str" in item && item.str.trim() ? [item] : []))
        .map((item) => ({
          text: item.str,
          x0: item.transform[4] as number,
          x1: (item.transform[4] as number) + item.width,
          y: item.transform[5] as number,
          height: Math.abs(item.transform[3] as number) || item.height || 8,
        }));
      lines.push(...groupLines(page, runs));
    }
    return lines;
  } catch (error) {
    const name = (error as { name?: string }).name;
    if (name === "PasswordException")
      throw new CasPasswordError(
        (error as { code?: number }).code === pdfjs.PasswordResponses.INCORRECT_PASSWORD,
      );
    if (name === "InvalidPDFException")
      throw new CasFormatError("not_pdf", "This file is not a readable PDF.");
    throw error;
  } finally {
    await task.destroy();
  }
}

type Run = Cell & { y: number; height: number };

/** Runs on one baseline become a line; runs further apart than a word gap become cells. */
export function groupLines(page: number, runs: Run[]): Line[] {
  const sorted = [...runs].sort((a, b) => b.y - a.y || a.x0 - b.x0);
  const rows: Run[][] = [];
  for (const run of sorted) {
    const row = rows.at(-1);
    if (row && Math.abs(row[0]!.y - run.y) <= 0.4 * Math.max(run.height, row[0]!.height))
      row.push(run);
    else rows.push([run]);
  }
  return rows.map((row) => {
    const height = Math.max(...row.map((r) => r.height));
    const cells: Cell[] = [];
    for (const run of row.sort((a, b) => a.x0 - b.x0)) {
      const cell = cells.at(-1);
      const gap = cell ? run.x0 - cell.x1 : Infinity;
      if (cell && gap < 0.5 * height) {
        cell.text += gap > 0.1 * height ? ` ${run.text}` : run.text;
        cell.x1 = Math.max(cell.x1, run.x1);
      } else cells.push({ text: run.text, x0: run.x0, x1: run.x1 });
    }
    for (const cell of cells) cell.text = cell.text.replace(/\s+/g, " ").trim();
    return { page, y: row[0]!.y, height, cells: cells.filter((c) => c.text) };
  });
}

const DATE = String.raw`(\d{2}-[A-Za-z]{3}-\d{4})`;
const CAS_TYPE_RE = /consolidated\s+account\s+(statement|summary)/i;
const PERIOD_RE = new RegExp(`${DATE}\\s+to\\s+${DATE}`, "i");
const DEMAT_RE =
  /NSDL\s+Consolidated\s+Account\s+Statement|Central\s+Depository\s+Services\s+\(India\)\s+Limited|\b(?:NSDL|CDSL)\s+demat\s+account/i;
const EMAIL_RE = /^\s*email\s+id\s*:/i;
const AMC_RE = /^(.+?\s+(?:MF|Mutual\s*Fund|Fund\s*House))$/i;
const FOLIO_RE = /Folio\s+No\s*:\s*([\dA-Z]+(?:\s*\/\s*[\dA-Z]+)?)/i;
const OPEN_RE = /Opening\s+Unit\s+Balance[:\s]*([\d,]*\.?\d+)/i;
const CLOSE_RE = /Closing\s+Unit\s+Balance[:\s]*([\d,]*\.?\d+)/i;
const NAV_RE = new RegExp(`NAV\\s+on\\s+${DATE}\\s*:\\s*INR\\s*([\\d,.]+)`, "i");
const VALUATION_RE = new RegExp(
  `(?:Valuation|Market\\s+Value)\\s+on\\s+${DATE}\\s*:\\s*INR\\s*([\\d,.]+)`,
  "i",
);
const TXN_DATE_RE = new RegExp(`^${DATE}\\s*(.*)$`);
const NUMBER_RE = /^\(?-?[\d,]*\.?\d+\)?$/;

// Scheme-header region rules from casparser's cams_detailed.py.
const HEADER_MARKER_RE =
  /Registrar\s*:|Advisor\s*:|ISIN\s*:|Nominee\s+\d|\bARN-?\d+\b|\bINA\d+\b|\b(?:CAMS|KFINTECH|KFIN|KARVY)\b/i;
const SCHEME_CODE_RE = /^\s*(?=[A-Z0-9 ]{0,40}[A-Z])[A-Z0-9]+(?: [A-Z0-9]+)*-/i;
const TRAILING_MARKER_RE = /(Registrar\s*:|Advisor\s*:|ISIN\s*:|\(\s*Advisor\s*:)\s*$/i;
const ADVISOR_RE = /[-\s]*\(\s*Advisor\s*:\s*[^)]+?\)/gi;
const NAME_ISIN_RE = /[-\s]*ISIN\s*:\s*INF[A-Z0-9]*/gi;
const NAME_END_RE =
  /\(\s*Advisor\s*:|Registrar\s*:?|Nominee\s+\d|\bARN-?\d+\b|\bINA\d+\b|\b(?:CAMS|KFINTECH|KFIN|KARVY)\b/i;
const ISIN_RE = /ISIN\s*:\s*([A-Z0-9]+)/i;
const FULL_ISIN_RE = /\bINF[0-9A-Z]{8}\d\b/;
const AMFI_RE = /AMFI(?:\s+Code)?\s*:\s*(\d{5,6})\b/i;
const HEADER_LABELS = new Set([
  "Date",
  "Transaction",
  "Amount",
  "Units",
  "Price",
  "NAV",
  "Unit",
  "Balance",
]);

const MONTHS = "jan feb mar apr may jun jul aug sep oct nov dec".split(" ");

function isoDate(text: string): IsoDate {
  const [d, m, y] = text.split("-");
  const month = MONTHS.indexOf(m!.toLowerCase()) + 1;
  if (!month) throw new CasFormatError("layout", `Unreadable date "${text}" in the statement.`);
  return `${y}-${String(month).padStart(2, "0")}-${d}`;
}

/** Indian-grouped figures; parentheses or a leading minus mark a negative. */
function amount(text: string): number {
  const negative = /^[(-]/.test(text);
  const value = Number(text.replace(/[(),-]/g, ""));
  return negative ? -value : value;
}

const lineText = (line: Line, sep = " ") => line.cells.map((c) => c.text).join(sep);

/** casparser's get_transaction_type, onto this project's kinds. */
export function classify(description: string, units: number | null): CasTransactionKind {
  const d = description.toLowerCase();
  if (/(?:div\.|dividend|idcw).*?@\s*rs\.\s*[\d.]+/s.test(d))
    return d.includes("reinvest") ? "dividend_reinvest" : "dividend_payout";
  if (units === null) {
    if (d.includes("stt")) return "stt";
    if (d.includes("stamp")) return "stamp_duty";
    if (d.includes("tds")) return "tds";
    return "other";
  }
  const switched = d.includes("switch") || /\bs\s*t\s*p\b|systematic\s+transfer/.test(d);
  if (units > 0) {
    if (switched) return d.includes("merger") ? "merger_in" : "switch_in";
    if (d.includes("bonus")) return "bonus";
    if (d.includes("segregat") || d.includes("gift")) return "other";
    return "purchase";
  }
  if (units < 0) {
    if (
      d.includes("gift") ||
      /reversal|rejection|dishonoured|mismatch|insufficient\s+balance|payment\s+not\s+received/.test(
        d,
      )
    )
      return "other";
    if (switched) return d.includes("merger") ? "merger_out" : "switch_out";
    return "redemption";
  }
  return "other";
}

/** casparser's get_parsed_scheme_name. */
function cleanSchemeName(name: string): string {
  return name
    .replace(/\((formerly|erstwhile).+?\)/gis, "")
    .replace(/\((Demat|Non-Demat).*/is, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[^a-zA-Z0-9_)]+$/, "")
    .trim();
}

type Header = Pick<CasScheme, "name" | "isin" | "amfiCode">;

/**
 * The scheme header can wrap over several lines, with the registrar or advisor value on a
 * line of its own. Every line between the folio (or the previous scheme) and the opening
 * balance is kept, and only lines that carry header markers are stitched together.
 */
function schemeHeader(region: string[]): Header | null {
  const at = region.findIndex(
    (l) => SCHEME_CODE_RE.test(l) && l.split("-")[0]!.trim().toUpperCase() !== "ARN",
  );
  if (at < 0) return null;
  const members: number[] = [];
  let forced = false;
  region.forEach((l, i) => {
    if (forced || HEADER_MARKER_RE.test(l) || SCHEME_CODE_RE.test(l)) {
      members.push(i);
      const advisor = /\(\s*Advisor\s*:/i.exec(l);
      forced = TRAILING_MARKER_RE.test(l) || (!!advisor && !l.slice(advisor.index).includes(")"));
    } else forced = false;
  });
  const text = members.map((i) => region[i]).join(" ");
  if (!text.includes("Registrar")) return null;
  let name = [
    region[at]!.slice(region[at]!.indexOf("-") + 1),
    ...members.filter((i) => i > at).map((i) => region[i]),
  ]
    .join(" ")
    .replace(ADVISOR_RE, "")
    .replace(NAME_ISIN_RE, "");
  const end = NAME_END_RE.exec(name);
  if (end) name = name.slice(0, end.index);
  const labelled = ISIN_RE.exec(text)?.[1];
  const isin =
    labelled && /^INF[0-9A-Z]{8}\d$/.test(labelled)
      ? labelled
      : (FULL_ISIN_RE.exec(text)?.[0] ?? null);
  return { name: cleanSchemeName(name), isin, amfiCode: AMFI_RE.exec(text)?.[1] ?? null };
}

type Columns = { amount?: number; units?: number; nav?: number; balance?: number };

/** Right edges of the numeric column labels, which head right-aligned figures. */
function tableColumns(lines: Line[], at: number): { columns: Columns; end: number } | null {
  const first = lines[at]!;
  let end = at;
  while (
    end + 1 < lines.length &&
    lines[end + 1]!.page === first.page &&
    first.y - lines[end + 1]!.y <= 15
  )
    end++;
  const cells = lines.slice(at, end + 1).flatMap((l) => l.cells);
  const words = new Set(
    cells.flatMap((c) => c.text.split(" ")).filter((w) => HEADER_LABELS.has(w)),
  );
  if (words.size < 4 || !words.has("Units")) return null;
  const edge = (...labels: string[]) => {
    const hits = cells.filter((c) => labels.includes(c.text));
    return hits.length ? Math.max(...hits.map((c) => c.x1)) : undefined;
  };
  return {
    columns: {
      amount: edge("Amount"),
      units: edge("Units"),
      nav: edge("Price", "NAV"),
      balance: edge("Unit", "Balance", "Unit Balance"),
    },
    end,
  };
}

type Figures = {
  amount: number | null;
  units: number | null;
  nav: number | null;
  balance: number | null;
};

/** Places each figure under its column, or by count as casparser's four row patterns do. */
function placeFigures(cells: Cell[], columns: Columns | null): Figures | null {
  const figures: Figures = { amount: null, units: null, nav: null, balance: null };
  const keys = ["amount", "units", "nav", "balance"] as const;
  if (columns && keys.every((k) => columns[k] !== undefined)) {
    let placed = true;
    for (const cell of cells) {
      const near = keys
        .map((k) => ({ k, dx: Math.abs(columns[k]! - cell.x1) }))
        .sort((a, b) => a.dx - b.dx)[0]!;
      if (near.dx > 40 || figures[near.k] !== null) placed = false;
      else figures[near.k] = amount(cell.text);
    }
    if (placed) return figures;
  }
  const v = cells.map((c) => amount(c.text));
  switch (v.length) {
    case 4:
      return { amount: v[0]!, units: v[1]!, nav: v[2]!, balance: v[3]! };
    case 3:
      return { amount: v[0]!, units: 0, nav: v[1]!, balance: v[2]! };
    case 2:
      return { amount: null, units: v[0]!, nav: null, balance: v[1]! };
    case 1:
      return { amount: v[0]!, units: null, nav: null, balance: null };
    default:
      return null;
  }
}

type Draft = CasScheme & {
  rows: { txn: CasTransaction; units: number | null; balance: number | null }[];
  nav: { date: IsoDate; nav: number } | null;
  value: { date: IsoDate; value: number } | null;
  closed: boolean;
};

export function parseCasLines(lines: Line[]): CasStatement {
  const firstPage = lines
    .filter((l) => l.page === 1)
    .map((l) => lineText(l))
    .join("\n");
  const all = lines.map((l) => lineText(l)).join("\n");
  if (DEMAT_RE.test(all))
    throw new CasFormatError(
      "demat",
      "This is a depository (NSDL or CDSL) statement. Upload the CAMS/KFintech statement instead: it lists mutual fund folios with their transactions.",
    );
  const kind = CAS_TYPE_RE.exec(firstPage)?.[1]?.toLowerCase();
  if (!kind)
    throw new CasFormatError(
      "not_cas",
      "This PDF is not a CAMS/KFintech Consolidated Account Statement.",
    );
  if (kind === "summary")
    throw new CasFormatError(
      "summary",
      "This is the summary statement, which has no transactions. Request the detailed one.",
    );

  const period = PERIOD_RE.exec(firstPage);
  const schemes: Draft[] = [];
  let investorName: string | null = null;
  let amc = "";
  let folio: string | null = null;
  let region: string[] | null = null;
  let current: Draft | null = null;
  let columns: Columns | null = null;
  let lastRow: { txn: CasTransaction; units: number | null; x0: number; line: Line } | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const text = lineText(line);
    const table = tableColumns(lines, i);
    if (table) {
      columns = table.columns;
      i = table.end;
      continue;
    }
    // The holder's name is the line under the email address on the first page.
    if (folio === null && investorName === null && i > 0 && EMAIL_RE.test(lineText(lines[i - 1]!)))
      investorName = /^[A-Za-z][A-Za-z .'&-]+$/.test(text) ? text : null;
    if (line.cells.length === 1 && AMC_RE.test(text) && !SCHEME_CODE_RE.test(text)) {
      amc = text;
      continue;
    }
    const folioNo = FOLIO_RE.exec(text)?.[1]?.replace(/\s+/g, " ");
    // A folio header repeated at the top of a page continues the scheme in progress.
    if (folioNo && !(current && !current.closed && folioNo === folio)) {
      folio = folioNo;
      region = [];
      current = null;
      continue;
    }
    if (current) {
      const nav = NAV_RE.exec(text);
      if (nav) current.nav = { date: isoDate(nav[1]!), nav: amount(nav[2]!) };
      const value = VALUATION_RE.exec(text);
      if (value) current.value = { date: isoDate(value[1]!), value: amount(value[2]!) };
    }
    const open = OPEN_RE.exec(text);
    if (open) {
      if (folio === null || region === null)
        throw new CasFormatError("layout", "A scheme appears before any folio in this statement.");
      const header = schemeHeader(region);
      if (!header)
        throw new CasFormatError(
          "layout",
          `Could not read the scheme name in folio ${folio}, so its transactions cannot be placed.`,
        );
      current = {
        ...header,
        amc,
        folio,
        openingUnits: amount(open[1]!),
        closingUnits: 0,
        transactions: [],
        valuation: null,
        rows: [],
        nav: null,
        value: null,
        closed: false,
      };
      schemes.push(current);
      region = null;
      lastRow = null;
      continue;
    }
    const close = CLOSE_RE.exec(text);
    if (close && current && !current.closed) {
      current.closingUnits = amount(close[1]!);
      current.closed = true;
      region = [];
      lastRow = null;
      continue;
    }
    if (current && !current.closed) {
      const dated = TXN_DATE_RE.exec(line.cells[0]?.text ?? "");
      if (dated) {
        let n = line.cells.length;
        while (n > 1 && NUMBER_RE.test(line.cells[n - 1]!.text)) n--;
        const rest = line.cells.slice(1, n);
        const description = [dated[2]!, ...rest.map((c) => c.text)].join(" ").trim();
        const figures = placeFigures(line.cells.slice(n), columns);
        if (description && !/^\d/.test(description) && figures) {
          const txn: CasTransaction = {
            date: isoDate(dated[1]!),
            kind: classify(description, figures.units),
            units: figures.units ?? 0,
            amount: figures.amount ?? 0,
            nav: figures.nav,
            description,
          };
          current.rows.push({ txn, units: figures.units, balance: figures.balance });
          lastRow = {
            txn,
            units: figures.units,
            x0: rest[0]?.x0 ?? line.cells[0]!.x0,
            line,
          };
        } else lastRow = null;
        continue;
      }
      // A description too long for its column wraps onto the line below, alone and
      // aligned with it (casparser issue #118).
      if (
        lastRow &&
        line.cells.length === 1 &&
        line.page === lastRow.line.page &&
        lastRow.line.y - line.y <= 2 * line.height &&
        Math.abs(line.cells[0]!.x0 - lastRow.x0) < 3
      ) {
        lastRow.txn.description += ` ${text}`;
        lastRow.txn.kind = classify(lastRow.txn.description, lastRow.units);
        lastRow.line = line;
        continue;
      }
      lastRow = null;
      continue;
    }
    region?.push(text);
  }

  if (!schemes.length)
    throw new CasFormatError("layout", "No mutual fund folios were found in this statement.");
  return {
    investorName,
    period: period ? { from: isoDate(period[1]!), to: isoDate(period[2]!) } : null,
    schemes: schemes.map(finish),
  };
}

const TOLERANCE = 0.0051;

function misread(draft: Draft): never {
  throw new CasFormatError(
    "layout",
    `The transactions read for ${draft.name} (folio ${draft.folio}) do not add up to the unit balances the statement prints, so a row was misread.`,
  );
}

/**
 * Some templates print reversed rows with the wrong sign; each row's printed unit balance is
 * the statement's own checksum, so it decides (casparser's _apply_balance_sign_fix). A total
 * that still disagrees with the closing balance means a row was misread, and every figure
 * built on it would be wrong.
 */
function finish(draft: Draft): CasScheme {
  let running = draft.openingUnits;
  for (const row of draft.rows) {
    if (row.units === null) continue;
    if (
      row.balance !== null &&
      Math.abs(running + row.units - row.balance) > TOLERANCE &&
      Math.abs(running - row.units - row.balance) <= TOLERANCE
    ) {
      row.units = -row.units;
      row.txn.units = row.units;
      row.txn.amount = -row.txn.amount;
      row.txn.kind = classify(row.txn.description, row.units);
    }
    running += row.units;
    if (row.balance !== null && Math.abs(running - row.balance) > TOLERANCE) misread(draft);
  }
  if (Math.abs(running - draft.closingUnits) > TOLERANCE) misread(draft);
  const value = draft.value;
  const nav =
    draft.nav?.nav ?? (value && draft.closingUnits ? value.value / draft.closingUnits : null);
  return {
    name: draft.name,
    amc: draft.amc,
    folio: draft.folio,
    isin: draft.isin,
    amfiCode: draft.amfiCode,
    openingUnits: draft.openingUnits,
    closingUnits: draft.closingUnits,
    transactions: draft.rows.map((r) => r.txn),
    valuation:
      value && nav !== null
        ? { date: value.date, nav, value: value.value }
        : draft.nav && draft.closingUnits === 0
          ? { date: draft.nav.date, nav: draft.nav.nav, value: 0 }
          : null,
  };
}
