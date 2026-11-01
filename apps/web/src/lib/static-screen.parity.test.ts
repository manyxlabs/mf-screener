// @vitest-environment node
/**
 * Holds static-screen to the live API. Runs only with MF_PARITY_API set to a running API
 * over the same store the export came from (`uv run uvicorn mf_api.main:app --port 8101`):
 *
 *   MF_PARITY_API=http://127.0.0.1:8101 pnpm --filter @mf/web test static-screen.parity
 *
 * /search and /schemes cover all of scheme_master on the API, inactive schemes included,
 * which the export does not hold. They are checked exactly against the API's own handlers
 * over the exported universe (scripts/search_reference.py), and their agreement with the
 * live API is reported alongside. Writes every result to $MF_PARITY_OUT when set.
 */
import type { Preset } from "@mf/shared";
import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { DEFAULT_FILTERS, presetToFilters, toQueryString } from "./screen-query";
import { loadScreenColumn } from "./static-data";
import { ApiError } from "./api-error";
import { NOTE, exportCsv, listSchemes, screen, search } from "./static-screen";

const API = process.env.MF_PARITY_API;
const DATA = fileURLToPath(new URL("../../public/data/", import.meta.url));
const REPO = fileURLToPath(new URL("../../../../", import.meta.url));
const report: Record<string, unknown> = {};

type Outcome = { status: number; body: unknown };

async function ours(call: () => Promise<unknown>): Promise<Outcome> {
  try {
    return { status: 200, body: await call() };
  } catch (error) {
    if (!(error instanceof ApiError)) throw error;
    return { status: error.status, body: error.message };
  }
}

async function live(path: string, csv = false): Promise<Outcome> {
  // A retry covers undici reusing a keep-alive socket uvicorn has just closed.
  const response = await fetch(`${API}${path}`).catch(() => fetch(`${API}${path}`));
  if (response.ok) {
    const body = csv ? await response.text() : await response.json();
    if (body?.methodology?.note) body.methodology.note = NOTE;
    return { status: 200, body };
  }
  const { detail } = (await response.json()) as {
    detail: string | { loc: string[]; msg: string }[];
  };
  const message = typeof detail === "string" ? detail : `${detail[0]!.loc[1]}: ${detail[0]!.msg}`;
  return { status: response.status, body: message };
}

/** The first difference, numbers equal to the export's 6 significant figures. */
function diff(a: unknown, b: unknown, path = ""): string | null {
  if (typeof a === "number" && typeof b === "number") {
    return Math.abs(a - b) <= 5.000001e-6 * Math.abs(b) ? null : `${path}: ${a} != ${b}`;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return `${path}: length ${a.length} != ${b.length}`;
    for (let i = 0; i < a.length; i++) {
      const found = diff(a[i], b[i], `${path}[${i}]`);
      if (found) return found;
    }
    return null;
  }
  if (a && b && typeof a === "object" && typeof b === "object") {
    const [ka, kb] = [Object.keys(a), Object.keys(b)];
    if (ka.join() !== kb.join()) return `${path}: keys ${ka.join()} != ${kb.join()}`;
    for (const k of ka) {
      const found = diff(a[k as keyof typeof a], b[k as keyof typeof b], `${path}.${k}`);
      if (found) return found;
    }
    return null;
  }
  return a === b ? null : `${path}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`;
}

/** RFC 4180 rows; enough for what pandas writes. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted && c === '"' && text[i + 1] === '"') {
      cell += '"';
      i++;
    } else if (c === '"') {
      quoted = !quoted;
    } else if (!quoted && (c === "," || c === "\n")) {
      row.push(cell);
      cell = "";
      if (c === "\n") {
        rows.push(row);
        row = [];
      }
    } else {
      cell += c;
    }
  }
  return rows;
}

const NUMBER = /^-?(\d+(\.\d*)?|\.\d+)(e[+-]\d+)?$/;

/** Exact text, except that a float cell need only agree to the export's precision. */
function csvRowDiff(a: Row, b: Row): string | null {
  for (const [name, u] of Object.entries(a)) {
    const [x, y] = [String(u), String(b[name])];
    if (x === y) continue;
    const floats = NUMBER.test(x) && NUMBER.test(y) && /[.e]/.test(x) && /[.e]/.test(y);
    if (!floats || diff(Number(x), Number(y))) return ` ${name}: ${x} != ${y}`;
  }
  return null;
}

type Row = Record<string, unknown>;

/**
 * Rows in order, except that rows whose leading sort key is equal in the export may trade
 * places: rounded to 6 significant figures the export cannot see the difference the store
 * ranks them by, so it falls through to the next key or scheme_code instead.
 */
async function rowsDiff(
  query: string,
  mine: Row[],
  theirs: Row[],
  cells: (a: Row, b: Row) => string | null,
): Promise<{ found: string | null; swapped: number }> {
  if (mine.length !== theirs.length) {
    return { found: `rows ${mine.length} != ${theirs.length}`, swapped: 0 };
  }
  const lead = (new URLSearchParams(query).get("sort") || "cagr_5y").split(",")[0]!;
  const column = await loadScreenColumn(lead.split(":")[0]!.trim());
  const codes = await loadScreenColumn("scheme_code");
  const position = new Map(codes.map((code, row) => [code, row]));
  const key = (row: Row) => column[position.get(row.scheme_code)!];
  let swapped = 0;
  for (const [i, a] of mine.entries()) {
    const b = theirs[i]!;
    if (a.scheme_code === b.scheme_code) {
      const found = cells(a, b);
      if (found) return { found: `row ${i}${found}`, swapped };
    } else if (key(a) !== null && key(a) === key(b)) swapped++;
    else return { found: `row ${i}: ${a.scheme_code} != ${b.scheme_code}`, swapped };
  }
  return { found: null, swapped };
}

const asRows = (csv: string[][]) =>
  csv.slice(4).map((cells) => Object.fromEntries(csv[3]!.map((name, i) => [name, cells[i]])));

async function check(
  label: string,
  cases: [path: string, call: () => Promise<unknown>][],
  csv = false,
): Promise<void> {
  const failures: string[] = [];
  let swapped = 0;
  for (const [path, call] of cases) {
    const theirs = await live(path, csv);
    const mine = await ours(call);
    const query = path.split("?")[1] ?? "";
    let found: string | null;
    if (mine.status !== theirs.status) {
      found = `status ${mine.status} (${JSON.stringify(mine.body)}) != ${theirs.status} (${JSON.stringify(theirs.body)})`;
    } else if (mine.status !== 200) {
      found = diff(mine.body, theirs.body);
    } else if (csv) {
      const [a, b] = [parseCsv(mine.body as string), parseCsv(theirs.body as string)];
      const head =
        a.slice(0, 4).join("\n") === b.slice(0, 4).join("\n") ? null : "comment or header lines";
      const rows = await rowsDiff(query, asRows(a), asRows(b), (x, y) => csvRowDiff(x, y));
      found = head ?? rows.found;
      swapped += rows.swapped;
    } else {
      const [a, b] = [mine.body as { rows: Row[] }, theirs.body as { rows: Row[] }];
      const rows = await rowsDiff(query, a.rows, b.rows, (x, y) => diff(x, y));
      found = diff({ ...a, rows: [] }, { ...b, rows: [] }) ?? rows.found;
      swapped += rows.swapped;
    }
    if (found) failures.push(`${path} -> ${found}`);
  }
  report[label] = { checks: cases.length, failures, rowsSwappedWithinRoundedTies: swapped };
  expect(failures).toEqual([]);
}

const canonical = <T extends { items: { scheme_name: string; scheme_code: string }[] }>(
  list: T,
) => ({
  ...list,
  items: [...list.items].sort(
    (a, b) =>
      (a.scheme_name < b.scheme_name ? -1 : a.scheme_name > b.scheme_name ? 1 : 0) ||
      (a.scheme_code < b.scheme_code ? -1 : 1),
  ),
});

const json = <T>(path: string) =>
  readFile(`${DATA}${path}`, "utf8").then((text) => JSON.parse(text) as T);

describe.skipIf(!API)("static-screen parity with the live API", () => {
  let presets: Preset[];
  let sortable: string[];
  let selectable: string[];
  let facets: Record<string, string[]>;

  beforeAll(async () => {
    const real = globalThis.fetch;
    vi.stubGlobal("fetch", async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      return url.startsWith("/data/")
        ? new Response(await readFile(`${DATA}${url.slice("/data/".length)}`))
        : real(input, init);
    });
    presets = await json<Preset[]>("global/presets.json");
    ({ sortable, selectable } = await json<{ sortable: string[]; selectable: string[] }>(
      "global/columns.json",
    ));
    facets = await json<Record<string, string[]>>("global/facets.json");
  });

  const screenCases = (queries: string[]) =>
    queries.map((q) => [`/screen?${q}`, () => screen(q)] as [string, () => Promise<unknown>]);
  const csvCases = (queries: string[]) =>
    queries.map(
      (q) => [`/export/csv?${q}`, () => exportCsv(q)] as [string, () => Promise<unknown>],
    );
  const qs = (params: Record<string, string | string[]>) => {
    const out = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) for (const x of [v].flat()) out.append(k, x);
    return out.toString();
  };

  it("matches presets, the default screen and paging", async () => {
    const queries = ["", toQueryString(DEFAULT_FILTERS)];
    for (const preset of presets) {
      const filters = { ...presetToFilters(preset), columns: preset.columns };
      for (const [page, pageSize] of [
        [1, 50],
        [2, 50],
        [1, 500],
      ] as const) {
        queries.push(toQueryString({ ...filters, page, pageSize }));
      }
    }
    for (const page of [1, 2, 3, 999]) {
      for (const size of [1, 10, 50, 500]) queries.push(`page=${page}&page_size=${size}`);
    }
    await check("presets and paging", screenCases(queries));
  }, 600_000);

  it("matches every sort column both ways", async () => {
    const queries = sortable.flatMap((c) =>
      ["asc", "desc"].flatMap((d) => [
        `sort=${c}:${d}&columns=${c}&page_size=500`,
        `sort=${c}:${d},cagr_1y:asc&columns=${c},cagr_1y&dedupe_families=false&page=3&page_size=100`,
      ]),
    );
    queries.push("sort=clean_sub_category:asc,amc:desc,scheme_name:asc&page_size=500");
    await check("sorts", screenCases(queries));
  }, 600_000);

  it("matches plan, option, dedupe, facet, range, search and attribute filters", async () => {
    const plans = [
      [],
      ["Direct"],
      ["Regular"],
      ["Direct", "Regular"],
      ["Regular", "Direct"],
      ["Unknown"],
    ];
    const options = [
      [],
      ["Growth"],
      ["IDCW Payout"],
      ["IDCW Payout", "Growth"],
      ["Growth", "Other"],
    ];
    const queries: string[] = [];
    for (const plan of plans) {
      for (const option of options) {
        for (const dedupe of ["true", "false"]) {
          queries.push(
            qs({
              plan,
              option,
              dedupe_families: dedupe,
              columns: "clean_plan,clean_option,fund_family_id",
              page_size: "500",
              sort: "fund_age_years:desc",
            }),
          );
        }
      }
    }
    queries.push("plan=&option=", "plan=Direct&plan=Direct&option=Growth");
    for (const value of facets.sub_categories!.slice(0, 80))
      queries.push(qs({ sub_category: value, page_size: "500" }));
    for (const value of facets.amcs!.slice(0, 75))
      queries.push(qs({ amc: value, page_size: "500", dedupe_families: "false" }));
    for (const value of [...facets.cap_bands!, ...facets.styles!]) {
      queries.push(
        qs({ cap_band: value, page_size: "500" }),
        qs({ style: value, page_size: "500" }),
      );
    }
    queries.push(
      qs({ category: ["Equity Scheme", "Debt Scheme"], page_size: "500" }),
      qs({ cap_band: ["Mid Cap", "Small Cap"], style: "Momentum", amc: facets.amcs!.slice(0, 30) }),
      "cagr_5y_min=0.15",
      "max_drawdown_5y_max=-0.2&max_drawdown_5y_min=-0.5&page_size=500",
      "fund_age_years_min=10&sharpe_5y_min=1&page_size=500",
      "expense_ratio_max=0.005&dedupe_families=false&page_size=500",
      "cagr_5y_min=&cagr_5y_max=0.1&cagr_5y_max=0.2&page_size=500",
      "cagr_5y_min=%201_0e-1%20&sharpe_3y_max=.5",
      "score_min=50&score_max=80&sort=score:desc&page_size=500",
    );
    for (const term of [
      "hdfc",
      "HDFC Flexi",
      "s&p 500, nasdaq",
      "118955",
      "1189",
      "flexi, small cap",
      "hdfc_flexi",
      "100%",
      "%",
      "_",
      " , ",
      "nifty 50 index",
      "Parag",
      "ppfas",
      "mirae asset",
      "ICICI Prudential Bluechip",
      "gold, silver",
      "INF",
      "zzzz",
    ]) {
      queries.push(
        qs({ search: term, page_size: "500" }),
        qs({ search: term, dedupe_families: "false", plan: [], page_size: "500" }),
      );
    }
    queries.push("search=");
    for (const attr of [
      "exit_load_pct_max=1",
      "exit_load_pct_max=0",
      "manager_tenure_years_min=3",
      "exit_load_pct_max=1&manager_tenure_years_min=2",
      "exit_load_pct_max=nan",
      "manager_tenure_years_min=-inf",
    ]) {
      queries.push(attr, `${attr}&dedupe_families=false&page=2`);
    }
    await check("filters", screenCases(queries));
  }, 600_000);

  it("matches every selectable column's values and duplicate or pinned columns", async () => {
    const all = [...selectable].sort().join(",");
    const queries = [1, 2, 3].map(
      (page) =>
        `columns=${all}&sort=scheme_name:asc&dedupe_families=false&plan=Direct&plan=Regular&option=Growth&option=IDCW%20Payout&page=${page}&page_size=500`,
    );
    queries.push(
      "columns=cagr_5y,cagr_5y,cagr_5y",
      "columns=scheme_code,cagr_5y,scheme_name",
      "columns=,",
      "columns=%20cagr_5y%20,,sharpe_3y",
    );
    await check("columns", screenCases(queries));
  }, 600_000);

  it("rejects the same input with the same status and message", async () => {
    const queries = [
      "page=0",
      "page=abc",
      "page=1.5",
      "page=",
      "page=1.0&page_size=1_0",
      "page=%2B2",
      "page_size=501",
      "page_size=0",
      "active_only=maybe",
      "active_only=",
      "active_only=%20true",
      "dedupe_families=2",
      "exit_load_pct_max=",
      "exit_load_pct_max=abc",
      "manager_tenure_years_min=0x1",
      "cagr_5y_min=abc",
      "cagr_5y_min=nan",
      "cagr_5y_max=inf",
      "cagr_5y_min=1e400",
      "foo_min=1",
      "_max=1",
      "styles=Value",
      "x=1&y=2",
      "sort=foo",
      "sort=cagr_5y:up",
      "sort=,cagr_5y",
      "sort=cagr_5y:%20",
      "sort=%20cagr_5y%20:%20ASC",
      "sort=cagr_5y:",
      "columns=foo,bar",
      "columns=it's",
      "columns=a%5Cb",
      "page=0&sort=foo",
      "sort=foo&columns=bar&baz_min=1",
      "page=2&page=x",
      "active_only=false",
    ];
    await check(
      "invalid and edge input",
      screenCases(queries.filter((q) => q !== "active_only=false")),
    );
    // Inactive schemes are not exported, so the static site refuses to pretend otherwise.
    await expect(screen("active_only=false")).rejects.toMatchObject({ status: 400 });
  }, 600_000);

  it("exports the same CSV", async () => {
    const all = [...selectable].sort().join(",");
    const queries = [
      "",
      toQueryString(DEFAULT_FILTERS, { omitPaging: true }),
      ...presets.map((p) =>
        toQueryString({ ...presetToFilters(p), columns: p.columns }, { omitPaging: true }),
      ),
      `columns=${all}&dedupe_families=false&plan=Direct&plan=Regular&plan=Unknown`,
      "columns=cagr_5y,cagr_5y&search=hdfc&sort=scheme_name:asc",
      "columns=missing_reasons,data_quality_flags,expense_ratio&dedupe_families=false",
      "exit_load_pct_max=1&manager_tenure_years_min=5",
      "page=1",
      "sort=foo",
      "cagr_5y_min=x",
    ];
    await check("csv", csvCases(queries), true);
  }, 600_000);

  it("answers /search and /schemes as the API's handlers do over the exported schemes", async () => {
    const terms = [
      "hdfc flexi",
      "parag parikh",
      "nifty 50 index",
      "sbi small cap",
      "axis bluechip",
      "quant small",
      "icici prudential",
      "mirae",
      "kotak emerging",
      "nippon india",
      "uti nifty",
      "motilal oswal nasdaq",
      "ppfas",
      "liquid",
      "gilt",
      "elss tax saver",
      "hdfc",
      "flex",
      "mid cap",
      "regular growth",
      "hdfc idcw",
      "canara robeco",
      "gold etf",
      "s&p 500",
      "118955",
      "the",
      "Aditya Birla Sun Life",
      "tata digital india",
      "dsp",
      "bandhan",
      "zzzz",
      "!!!",
    ];
    const jobs = [
      ...terms.flatMap((q) => [
        { path: "search", params: { q, limit: 25 } },
        { path: "search", params: { q, limit: 8 } },
      ]),
      ...terms.flatMap((q) => [
        { path: "schemes", params: { q, limit: 10 } },
        { path: "schemes", params: { q, limit: 500 } },
      ]),
      { path: "schemes", params: { limit: 50, offset: 100 } },
      { path: "schemes", params: { sub_category: "Flexi Cap Fund", limit: 500 } },
      { path: "schemes", params: { amc: "HDFC Mutual Fund", q: "index", limit: 500 } },
    ];
    const reference = JSON.parse(
      execFileSync("uv", ["run", "python", "-I", "apps/web/scripts/search_reference.py"], {
        cwd: REPO,
        input: JSON.stringify(jobs),
        maxBuffer: 1 << 28,
      }).toString(),
    ) as unknown[];
    const failures: string[] = [];
    const agreement: Record<string, string> = {};
    for (const [i, job] of jobs.entries()) {
      const params = Object.fromEntries(Object.entries(job.params).map(([k, v]) => [k, String(v)]));
      const query = new URLSearchParams(params).toString();
      const mine =
        job.path === "search"
          ? await search(params.q!, Number(params.limit))
          : await listSchemes(query);
      // Equal names are DuckDB's to order arbitrarily; ours breaks the tie by code.
      const expected =
        job.path === "search"
          ? (reference[i] as unknown[])
          : [canonical(reference[i] as { items: { scheme_name: string; scheme_code: string }[] })];
      const found = expected.every((answer) => diff(mine, answer)) ? diff(mine, expected[0]) : null;
      if (found) failures.push(`/${job.path}?${query} -> ${found}`);
      if (job.path === "search" && params.limit === "25") {
        const codes = new Set(await json<string[]>("screen/scheme_code.json"));
        const api = (await live(`/search?${query}`)).body as { items: { scheme_code: string }[] };
        const theirs = api.items.map((x) => x.scheme_code).filter((c) => codes.has(c));
        const mineCodes = (mine as { items: { scheme_code: string }[] }).items.map(
          (x) => x.scheme_code,
        );
        const same = theirs.findIndex((c, k) => c !== mineCodes[k]);
        const top = mineCodes.slice(0, theirs.length);
        agreement[params.q!] =
          `${same < 0 ? theirs.length : same}/${theirs.length} in order, ` +
          `${top.filter((c) => theirs.includes(c)).length}/${theirs.length} shared`;
      }
    }
    report["search and schemes"] = {
      checks: jobs.length,
      failures,
      liveSearchAgreement: agreement,
    };
    expect(failures).toEqual([]);
  }, 600_000);

  it("writes the report", async () => {
    if (process.env.MF_PARITY_OUT) {
      await writeFile(process.env.MF_PARITY_OUT, JSON.stringify(report, null, 2));
    }
  });
});
