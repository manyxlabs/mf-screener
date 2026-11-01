/**
 * GET /screen, /schemes, /search and /export/csv answered in the browser from the static
 * export, for the server-less site. A port of apps/api/mf_api/screen.py and the matching
 * handlers in main.py, down to which input is refused and with what message; the parity
 * battery in static-screen.parity.test.ts holds it to the live API.
 *
 * The export holds active schemes only, so every answer is over that universe.
 */
import type {
  ColumnsResponse,
  Metadata,
  Methodology,
  ScreenResponse,
  SearchResponse,
  schemeListSchema,
} from "@mf/shared";
import type { z } from "zod";
import { ApiError } from "./api-error";
import { loadJson, loadScreenColumn } from "@/lib/static-data";

type SchemeList = z.infer<typeof schemeListSchema>;
type Value = string | number | boolean | null;
type Table = Record<string, unknown[]>;
type Sort = [column: string, direction: "asc" | "desc"][];
type Range = [min: number | null, max: number | null];

// columns.py PINNED_COLUMNS; /columns does not publish it.
const PINNED = ["scheme_name", "scheme_code"];
const LISTS = {
  category: "clean_category",
  sub_category: "clean_sub_category",
  cap_band: "cap_band",
  style: "style",
  amc: "amc",
  plan: "clean_plan",
  option: "clean_option",
} as const;
// The export precomputes manager tenure on its own date, where the API uses today's.
const ATTRIBUTES = {
  exit_load_pct_max: "attr_exit_load_pct",
  manager_tenure_years_min: "attr_manager_tenure_years",
} as const;
const EXPORT_PARAMS = [
  ...Object.keys(LISTS),
  "active_only",
  "columns",
  "dedupe_families",
  "search",
  "sort",
];
const SCREEN_PARAMS = [...EXPORT_PARAMS, "page", "page_size", ...Object.keys(ATTRIBUTES)];
const NOTE =
  "Peer-relative metrics come from the stored snapshot, which uses the default " +
  "peer universe. Change the universe on a fund page to recompute it live.";

const loadGlobal = async () => {
  const [columns, metadata, methodology] = await Promise.all([
    loadJson<ColumnsResponse>("global/columns.json"),
    loadJson<Metadata>("global/metadata.json"),
    loadJson<Methodology>("global/methodology.json"),
  ]);
  return {
    sortable: new Set(columns.sortable),
    selectable: new Set(columns.selectable),
    numeric: new Set(columns.metrics.map((m) => m.name)),
    defaultColumns: columns.default,
    metadata,
    riskFree: methodology.risk_free_rate.annual,
  };
};

async function loadTable(names: Iterable<string>): Promise<Table> {
  const unique = [...new Set(["scheme_code", ...names])];
  const arrays = await Promise.all(unique.map(loadScreenColumn));
  return Object.fromEntries(unique.map((name, i) => [name, arrays[i]!]));
}

// ---- Query parameters, read the way Starlette and pydantic read them ----

const bad = (message: string) => new ApiError(message, 400);
const invalid = (param: string, message: string) => new ApiError(`${param}: ${message}`, 422);

/** Repeated keys: the last value wins, at the position of the first, as in Starlette. */
function readQuery(query: string) {
  const params = new URLSearchParams(query);
  const last = new Map<string, string>();
  for (const [key, value] of params) last.set(key, value);
  return { params, last };
}

function rejectUnknown(last: Map<string, string>, allowed: string[]): void {
  const unknown = [...last.keys()]
    .filter((k) => !allowed.includes(k) && !k.endsWith("_min") && !k.endsWith("_max"))
    .sort();
  if (unknown.length) {
    throw new ApiError(
      `Unknown query parameter(s): ${unknown.join(", ")}. ` +
        `This endpoint accepts: ${[...allowed].sort().join(", ")}, ` +
        "plus <metric>_min and <metric>_max.",
      422,
    );
  }
}

const INT = /^\s*[+-]?\d(?:_?\d)*(?:\.0+)?\s*$/;
const FLOAT =
  /^\s*[+-]?(?:(?:\d(?:_?\d)*(?:\.(?:\d(?:_?\d)*)?)?|\.\d(?:_?\d)*)(?:e[+-]?\d(?:_?\d)*)?|inf(?:inity)?|nan)\s*$/i;
const TRUE = ["1", "on", "t", "true", "y", "yes"];
const FALSE = ["0", "off", "f", "false", "n", "no"];

/** Python's float(): underscores between digits, inf and nan, surrounding whitespace. */
function pyFloat(raw: string): number | undefined {
  if (!FLOAT.test(raw)) return undefined;
  const text = raw.trim().toLowerCase().replaceAll("_", "");
  if (text.endsWith("nan")) return NaN;
  if (text.endsWith("inf") || text.endsWith("infinity")) {
    return text.startsWith("-") ? -Infinity : Infinity;
  }
  return Number(text);
}

function intParam(
  last: Map<string, string>,
  name: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const raw = last.get(name);
  if (raw === undefined) return fallback;
  if (!INT.test(raw)) {
    throw invalid(name, "Input should be a valid integer, unable to parse string as an integer");
  }
  const value = Number(raw.trim().replaceAll("_", ""));
  if (value < min) throw invalid(name, `Input should be greater than or equal to ${min}`);
  if (value > max) throw invalid(name, `Input should be less than or equal to ${max}`);
  return value;
}

function boolParam(last: Map<string, string>, name: string, fallback: boolean): boolean {
  const raw = last.get(name)?.toLowerCase();
  if (raw === undefined) return fallback;
  if (TRUE.includes(raw)) return true;
  if (FALSE.includes(raw)) return false;
  throw invalid(name, "Input should be a valid boolean, unable to interpret input");
}

/** Python's repr() of a str, as the API's messages quote input with !r. */
function pyRepr(text: string): string {
  const quote = text.includes("'") && !text.includes('"') ? '"' : "'";
  const body = text
    .replace(/[\\\n\r\t]/g, (c) => ({ "\\": "\\\\", "\n": "\\n", "\r": "\\r", "\t": "\\t" })[c]!)
    .replace(/[\x00-\x1f\x7f]/g, (c) => `\\x${c.charCodeAt(0).toString(16).padStart(2, "0")}`);
  return quote + (quote === "'" ? body.replaceAll("'", "\\'") : body) + quote;
}

type Universe = Awaited<ReturnType<typeof loadGlobal>>;

function parseSort(raw: string | undefined, sortable: Set<string>): Sort {
  if (!raw) return [["cagr_5y", "desc"]];
  return raw.split(",").map((token) => {
    const [head = "", ...rest] = token.trim().split(":");
    const name = head.trim();
    const direction = (rest.join(":") || "desc").trim().toLowerCase();
    if (!sortable.has(name)) throw bad(`Unknown sort column: ${pyRepr(name)}`);
    if (direction !== "asc" && direction !== "desc") {
      throw bad(`Sort direction must be asc or desc, got ${pyRepr(direction)}`);
    }
    return [name, direction];
  });
}

function parseColumns(raw: string | undefined, universe: Universe): string[] {
  if (!raw) return [...universe.defaultColumns];
  const names = raw
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean);
  const unknown = names.filter((c) => !universe.selectable.has(c));
  if (unknown.length) throw bad(`Unknown columns: [${unknown.map(pyRepr).join(", ")}]`);
  return [...PINNED, ...names.filter((c) => !PINNED.includes(c))];
}

/** Every `<metric>_min` / `<metric>_max`; an unknown metric is refused, not ignored. */
function parseRanges(last: Map<string, string>, numeric: Set<string>): Map<string, Range> {
  const ranges = new Map<string, Range>();
  for (const [key, value] of last) {
    if (Object.hasOwn(ATTRIBUTES, key) || !(key.endsWith("_min") || key.endsWith("_max"))) {
      continue;
    }
    const column = key.slice(0, -4);
    if (!numeric.has(column)) throw bad(`Unknown filterable metric: ${pyRepr(column)}`);
    if (value === "") continue;
    const number = pyFloat(value);
    if (number === undefined) throw bad(`${key} must be a number, got ${pyRepr(value)}`);
    if (!Number.isFinite(number)) throw bad(`${key} must be finite`);
    const range = ranges.get(column) ?? [null, null];
    range[key.endsWith("_min") ? 0 : 1] = number;
    ranges.set(column, range);
  }
  return ranges;
}

type ScreenRequest = {
  page: number;
  pageSize: number;
  search: string | null;
  sort: Sort;
  columns: string[];
  lists: Record<keyof typeof LISTS, string[]>;
  dedupe: boolean;
  ranges: Map<string, Range>;
  attributes: Partial<Record<keyof typeof ATTRIBUTES, number>>;
};

/** Checks in the API's order: unknown keys, then typed parameters, then the parsers. */
function parseRequest(query: string, universe: Universe, paged: boolean): ScreenRequest {
  const { params, last } = readQuery(query);
  rejectUnknown(last, paged ? SCREEN_PARAMS : EXPORT_PARAMS);
  const page = paged ? intParam(last, "page", 1, 1, Infinity) : 1;
  const pageSize = paged ? intParam(last, "page_size", 50, 1, 500) : 1;
  // active_only is validated but cannot widen anything: inactive schemes are not exported.
  boolParam(last, "active_only", true);
  const dedupe = boolParam(last, "dedupe_families", true);
  const attributes: ScreenRequest["attributes"] = {};
  if (paged) {
    for (const key of Object.keys(ATTRIBUTES) as (keyof typeof ATTRIBUTES)[]) {
      const raw = last.get(key);
      if (raw === undefined) continue;
      const value = pyFloat(raw);
      if (value === undefined) {
        throw invalid(key, "Input should be a valid number, unable to parse string as a number");
      }
      attributes[key] = value;
    }
  }
  const lists = Object.fromEntries(
    Object.keys(LISTS).map((key) => [key, params.getAll(key)]),
  ) as ScreenRequest["lists"];
  if (!params.has("plan")) lists.plan = ["Direct"];
  if (!params.has("option")) lists.option = ["Growth"];
  return {
    page,
    pageSize,
    search: last.get("search") ?? null,
    sort: parseSort(last.get("sort"), universe.sortable),
    columns: parseColumns(last.get("columns"), universe),
    lists,
    dedupe,
    ranges: parseRanges(last, universe.numeric),
    attributes,
  };
}

/** A SQL `LIKE '%term%'`: `%` and `_` inside the term are wildcards there too. */
function like(term: string): (value: unknown) => boolean {
  const source = [...term]
    .map((c) =>
      c === "%" ? "[^]*" : c === "_" ? "[^]" : c.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&"),
    )
    .join("");
  const pattern = new RegExp(source, "u");
  return (value) => typeof value === "string" && pattern.test(value);
}

const lower = (value: unknown) => (typeof value === "string" ? value.toLowerCase() : null);

/** Rows matching the name, AMC or code test of any comma-separated alternative. */
function searchTest(search: string | null, table: Table): ((row: number) => boolean) | null {
  const terms = (search ?? "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
  if (!terms.length) return null;
  const tests = terms.map((term) => [like(term.toLowerCase()), like(term)] as const);
  const { scheme_name: names = [], amc: amcs = [], scheme_code: codes = [] } = table;
  return (row) =>
    tests.some(
      ([folded, exact]) =>
        folded(lower(names[row])) || folded(lower(amcs[row])) || exact(codes[row]),
    );
}

const compare = (a: Value, b: Value) => (a! < b! ? -1 : a! > b! ? 1 : 0);

/** Filters, then one winner per fund family, then the attribute filters, then the sort. */
function select(request: ScreenRequest, table: Table): number[] {
  const tests: ((row: number) => boolean)[] = [];
  for (const [key, values] of Object.entries(request.lists)) {
    if (!values.length) continue;
    const allowed = new Set<unknown>(values);
    const column = table[LISTS[key as keyof typeof LISTS]]!;
    tests.push((row) => allowed.has(column[row]));
  }
  const search = searchTest(request.search, table);
  if (search) tests.push(search);
  for (const [name, [min, max]] of request.ranges) {
    const column = table[name] as (number | null)[];
    tests.push((row) => {
      const value = column[row];
      return value != null && (min === null || value >= min) && (max === null || value <= max);
    });
  }
  const codes = table.scheme_code as string[];
  let rows = codes.map((_, row) => row).filter((row) => tests.every((test) => test(row)));
  if (request.dedupe) rows = dedupeFamilies(rows, request, table);

  const { exit_load_pct_max: loadMax, manager_tenure_years_min: tenureMin } = request.attributes;
  if (loadMax !== undefined || tenureMin !== undefined) {
    const load = table[ATTRIBUTES.exit_load_pct_max] as (number | null)[];
    const tenure = table[ATTRIBUTES.manager_tenure_years_min] as (number | null)[];
    // A missing attribute satisfies no filter. DuckDB ranks NaN above every number.
    rows = rows.filter(
      (row) =>
        (loadMax === undefined ||
          (load[row] != null && (Number.isNaN(loadMax) || load[row]! <= loadMax))) &&
        (tenureMin === undefined || (tenure[row] != null && tenure[row]! >= tenureMin)),
    );
  }

  const keys = request.sort.map(([name, direction]) => ({
    column: table[name] as Value[],
    sign: direction === "desc" ? -1 : 1,
  }));
  return rows.sort((a, b) => {
    for (const { column, sign } of keys) {
      const x = column[a] ?? null;
      const y = column[b] ?? null;
      if (x === y) continue;
      // NULLS LAST in both directions: a missing metric must never win a ranking.
      if (x === null) return 1;
      if (y === null) return -1;
      return compare(x, y) * sign;
    }
    return compare(codes[a]!, codes[b]!);
  });
}

/** screen.py `_family_relation`: the request's own plan/option order, then Direct, Growth. */
function dedupeFamilies(rows: number[], request: ScreenRequest, table: Table): number[] {
  const {
    fund_family_id: families = [],
    clean_plan: plans = [],
    clean_option: options = [],
  } = table;
  const codes = table.scheme_code as string[];
  const rank = (preferred: string[], value: unknown) => {
    const index = preferred.indexOf(value as string);
    return index < 0 ? preferred.length : index;
  };
  const key = (row: number) => [
    rank(request.lists.plan, plans[row]),
    rank(request.lists.option, options[row]),
    plans[row] === "Direct" ? 0 : 1,
    options[row] === "Growth" ? 0 : 1,
  ];
  const before = (a: number, b: number) => {
    const [ka, kb] = [key(a), key(b)];
    const index = ka.findIndex((value, i) => value !== kb[i]);
    return index >= 0 ? ka[index]! < kb[index]! : codes[a]! < codes[b]!;
  };
  // A null family is one partition, as in SQL PARTITION BY.
  const winners = new Map<unknown, number>();
  for (const row of rows) {
    const current = winners.get(families[row]);
    if (current === undefined || before(row, current)) winners.set(families[row], row);
  }
  return [...winners.values()];
}

/** The output names for `columns`: a repeated column comes back as `<name>_1`, as DuckDB names it. */
function outputNames(columns: string[]): string[] {
  const seen = new Map<string, number>();
  return columns.map((column) => {
    const count = seen.get(column) ?? 0;
    seen.set(column, count + 1);
    return count ? `${column}_${count}` : column;
  });
}

function tableNeeds(request: ScreenRequest): string[] {
  return [
    ...request.columns,
    ...Object.entries(request.lists)
      .filter(([, values]) => values.length)
      .map(([key]) => LISTS[key as keyof typeof LISTS]),
    ...(request.search?.trim() ? ["scheme_name", "amc"] : []),
    ...request.ranges.keys(),
    ...request.sort.map(([name]) => name),
    ...(request.dedupe ? ["fund_family_id", "clean_plan", "clean_option"] : []),
    ...Object.entries(ATTRIBUTES)
      .filter(([key]) => Object.hasOwn(request.attributes, key))
      .map(([, column]) => column),
  ];
}

export async function screen(query: string): Promise<ScreenResponse> {
  const universe = await loadGlobal();
  const request = parseRequest(query, universe, true);
  const table = await loadTable(tableNeeds(request));
  const rows = select(request, table);
  const offset = (request.page - 1) * request.pageSize;
  const names = outputNames(request.columns);
  const { metadata } = universe;
  const { lists } = request;
  return {
    total: rows.length,
    page: request.page,
    page_size: request.pageSize,
    pages: Math.ceil(rows.length / request.pageSize),
    columns: request.columns,
    rows: rows
      .slice(offset, offset + request.pageSize)
      .map((row) =>
        Object.fromEntries(request.columns.map((c, i) => [names[i], table[c]![row] ?? null])),
      ),
    methodology: {
      as_of: metadata.coverage.metrics_as_of,
      version: metadata.methodology_version,
      peer_universe: metadata.default_universe,
      risk_free_annual: universe.riskFree,
      applied_filters: {
        plans: lists.plan,
        options: lists.option,
        // Always true here, whatever was asked: the rows can only be active schemes.
        active_only: true,
        categories: lists.category,
        sub_categories: lists.sub_category,
        cap_bands: lists.cap_band,
        styles: lists.style,
        amcs: lists.amc,
        search: request.search,
        ranges: Object.fromEntries(request.ranges),
        // JSON has no NaN or Infinity; the API serialises them as null.
        attribute_filters: Object.fromEntries(
          Object.entries(request.attributes).map(([k, v]) => [k, Number.isFinite(v) ? v : null]),
        ),
      },
      sort: request.sort.map(([name, direction]) => `${name}:${direction}`),
      note: NOTE,
      disclaimer: metadata.disclaimer,
    },
  };
}

// ---- CSV, formatted as pandas' to_csv writes a DuckDB frame ----

/** Python's repr() of a float. */
function pyFloatText(value: number): string {
  if (Object.is(value, -0)) return "-0.0";
  const [mantissa, exponent] = value.toExponential().split("e") as [string, string];
  const power = Number(exponent);
  if (power < -4 || power >= 16) {
    return `${mantissa}e${power < 0 ? "-" : "+"}${String(Math.abs(power)).padStart(2, "0")}`;
  }
  const text = String(value);
  return text.includes(".") ? text : `${text}.0`;
}

/** Python's json.dumps with its default separators and ensure_ascii. */
function pyJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(pyJson).join(", ")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value).map(([k, v]) => `${pyJson(k)}: ${pyJson(v)}`);
    return `{${entries.join(", ")}}`;
  }
  return JSON.stringify(value).replace(
    /[\u007f-￿]/g,
    (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
}

function csvCell(value: unknown, integral: boolean): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "boolean") return value ? "True" : "False";
  if (typeof value === "number") return integral ? String(value) : pyFloatText(value);
  if (typeof value === "string") return value;
  // The stored JSON text, which the export parsed: Python wrote most of it, but the
  // view rewrites missing_reasons through DuckDB's compact JSON when it adds the TER reason.
  const compact = (value as Record<string, unknown>).expense_ratio === "ter_not_published";
  return compact ? JSON.stringify(value) : pyJson(value);
}

const csvQuote = (text: string) =>
  /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;

export async function exportCsv(query: string): Promise<string> {
  const universe = await loadGlobal();
  const request = parseRequest(query, universe, false);
  const table = await loadTable(tableNeeds(request));
  const rows = select(request, table);
  // The JSON export erased DOUBLE vs INTEGER; a column holding only whole numbers is
  // taken as INTEGER, which at worst prints a whole DOUBLE as `2` rather than `2.0`.
  const integral = request.columns.map((c) =>
    table[c]!.every((v) => typeof v !== "number" || Number.isInteger(v)),
  );
  const { metadata } = universe;
  const lines = [
    `# Indian MF screener export. ${metadata.disclaimer}`,
    `# metrics_as_of=${metadata.coverage.metrics_as_of || "unknown"} ` +
      `methodology_version=${metadata.methodology_version}`,
    `# peer_universe=${pyJson(metadata.default_universe)}`,
    outputNames(request.columns).map(csvQuote).join(","),
    ...rows.map((row) =>
      request.columns.map((c, i) => csvQuote(csvCell(table[c]![row], integral[i]!))).join(","),
    ),
  ];
  return `${lines.join("\n")}\n`;
}

// ---- /schemes and /search ----

const SCHEME_FIELDS = [
  "scheme_code",
  "scheme_name",
  "amc",
  "clean_category",
  "clean_sub_category",
  "clean_plan",
  "clean_option",
  "isin_growth",
  "isin_dividend",
  "is_active",
  "first_nav_date",
  "last_nav_date",
  "latest_nav",
  "latest_nav_date",
  "latest_aum",
  "aum_quarter",
  "fund_age_years",
  "fund_family_id",
  "expense_ratio",
] as const;

const pick = <K extends string>(table: Table, fields: readonly K[], row: number) =>
  Object.fromEntries(fields.map((f) => [f, table[f]![row] ?? null])) as Record<K, never>;

/** GET /schemes: `q` (a LIKE over name, AMC and code), sub_category, amc, limit, offset. */
export async function listSchemes(query: string): Promise<SchemeList> {
  const { last } = readQuery(query);
  const limit = intParam(last, "limit", 50, 1, 500);
  const offset = intParam(last, "offset", 0, 0, Infinity);
  const table = await loadTable(SCHEME_FIELDS);
  const q = last.get("q");
  const tests: ((row: number) => boolean)[] = [];
  if (q) {
    const [folded, exact] = [like(q.toLowerCase()), like(q)];
    tests.push(
      (row) =>
        folded(lower(table.scheme_name![row])) ||
        folded(lower(table.amc![row])) ||
        exact(table.scheme_code![row]),
    );
  }
  for (const [param, column] of [
    ["sub_category", "clean_sub_category"],
    ["amc", "amc"],
  ] as const) {
    const wanted = last.get(param);
    if (wanted) tests.push((row) => table[column]![row] === wanted);
  }
  const names = table.scheme_name as string[];
  const codes = table.scheme_code as string[];
  const rows = codes
    .map((_, row) => row)
    .filter((row) => tests.every((test) => test(row)))
    // The API orders by name alone; the code makes its arbitrary tie order stable.
    .sort((a, b) => compare(names[a]!, names[b]!) || compare(codes[a]!, codes[b]!));
  return {
    total: rows.length,
    limit,
    offset,
    items: rows.slice(offset, offset + limit).map((row) => pick(table, SCHEME_FIELDS, row)),
  };
}

// DuckDB's fts 'english' list, which `create_fts_index` drops from documents and queries.
const STOPWORDS = new Set(
  (
    "a a's able about above according accordingly across actually after afterwards again " +
    "against ain't all allow allows almost alone along already also although always am among " +
    "amongst an and another any anybody anyhow anyone anything anyway anyways anywhere apart " +
    "appear appreciate appropriate are aren't around as aside ask asking associated at available " +
    "away awfully b be became because become becomes becoming been before beforehand behind " +
    "being believe below beside besides best better between beyond both brief but by c c'mon " +
    "c's came can can't cannot cant cause causes certain certainly changes clearly co com come " +
    "comes concerning consequently consider considering contain containing contains " +
    "corresponding could couldn't course currently d definitely described despite did didn't " +
    "different do does doesn't doing don't done down downwards during e each edu eg eight " +
    "either else elsewhere enough entirely especially et etc even ever every everybody everyone " +
    "everything everywhere ex exactly example except f far few fifth first five followed " +
    "following follows for former formerly forth four from further furthermore g get gets " +
    "getting given gives go goes going gone got gotten greetings h had hadn't happens hardly " +
    "has hasn't have haven't having he he's hello help hence her here here's hereafter hereby " +
    "herein hereupon hers herself hi him himself his hither hopefully how howbeit however i " +
    "i'd i'll i'm i've ie if ignored immediate in inasmuch inc indeed indicate indicated " +
    "indicates inner insofar instead into inward is isn't it it'd it'll it's its itself j just " +
    "k keep keeps kept know knows known l last lately later latter latterly least less lest let " +
    "let's like liked likely little look looking looks ltd m mainly many may maybe me mean " +
    "meanwhile merely might more moreover most mostly much must my myself n name namely nd near " +
    "nearly necessary need needs neither never nevertheless new next nine no nobody non none " +
    "noone nor normally not nothing novel now nowhere o obviously of off often oh ok okay old " +
    "on once one ones only onto or other others otherwise ought our ours ourselves out outside " +
    "over overall own p particular particularly per perhaps placed please plus possible " +
    "presumably probably provides q que quite qv r rather rd re really reasonably regarding " +
    "regardless regards relatively respectively right s said same saw say saying says second " +
    "secondly see seeing seem seemed seeming seems seen self selves sensible sent serious " +
    "seriously seven several shall she should shouldn't since six so some somebody somehow " +
    "someone something sometime sometimes somewhat somewhere soon sorry specified specify " +
    "specifying still sub such sup sure t t's take taken tell tends th than thank thanks thanx " +
    "that that's thats the their theirs them themselves then thence there there's thereafter " +
    "thereby therefore therein theres thereupon these they they'd they'll they're they've think " +
    "third this thorough thoroughly those though three through throughout thru thus to " +
    "together too took toward towards tried tries truly try trying twice two u un under " +
    "unfortunately unless unlikely until unto up upon us use used useful uses using usually " +
    "uucp v value various very via viz vs w want wants was wasn't way we we'd we'll we're " +
    "we've welcome well went were weren't what what's whatever when whence whenever where " +
    "where's whereafter whereas whereby wherein whereupon wherever whether which while whither " +
    "who who's whoever whole whom whose why will willing wish with within without won't wonder " +
    "would wouldn't x y yes yet you you'd you'll you're you've your yours yourself yourselves " +
    "z zero"
  ).split(" "),
);

// A query naming any of these wants that plan or option, so relevance alone decides.
const VARIANT_WORDS = new Set([
  "direct",
  "regular",
  "growth",
  "idcw",
  "dividend",
  "payout",
  "reinvestment",
  "bonus",
]);

const SEARCH_FIELDS = [
  "scheme_code",
  "scheme_name",
  "amc",
  "clean_sub_category",
  "clean_plan",
  "clean_option",
] as const;

/** The fts tokenizer, reduced to what it does to `search_text` ([a-z0-9 ] only): drop digits. */
const ftsTokens = (text: string) =>
  text
    .replace(/[0-9]+/g, " ")
    .split(/\s+/)
    .filter((t) => t && !STOPWORDS.has(t));

/** The bm25 index `create_fts_index` builds over `search_text`, built once per page load. */
let searchIndex: Promise<{
  table: Table;
  postings: Map<string, [number, number][]>;
  lengths: number[];
}> | null = null;

function loadSearchIndex() {
  searchIndex ??= loadTable([...SEARCH_FIELDS, "search_text", "fund_family_id"]).then((table) => {
    const postings = new Map<string, [number, number][]>();
    const lengths = (table.search_text as (string | null)[]).map((text, doc) => {
      const tokens = ftsTokens(text ?? "");
      const counts = new Map<string, number>();
      for (const t of tokens) counts.set(t, (counts.get(t) ?? 0) + 1);
      for (const [t, tf] of counts) {
        const list = postings.get(t);
        if (list) list.push([doc, tf]);
        else postings.set(t, [[doc, tf]]);
      }
      return tokens.length;
    });
    return { table, postings, lengths };
  });
  searchIndex.catch(() => (searchIndex = null));
  return searchIndex;
}

/**
 * GET /search: DuckDB `match_bm25` (k=1.2, b=0.75) over the prefix-expanded `search_text`,
 * ranked as main.py `search` does. Its corpus statistics are the active schemes', not all
 * of scheme_master's, so scores (not the method) differ from the live API's.
 */
export async function search(q: string, limit: number): Promise<SearchResponse> {
  const length = [...q].length;
  if (length < 1) throw invalid("q", "String should have at least 1 character");
  if (length > 200) throw invalid("q", "String should have at most 200 characters");
  if (!Number.isInteger(limit)) {
    throw invalid("limit", "Input should be a valid integer, unable to parse string as an integer");
  }
  if (limit < 1) throw invalid("limit", "Input should be greater than or equal to 1");
  if (limit > 25) throw invalid("limit", "Input should be less than or equal to 25");
  const words = q.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  if (!words.length) return { query: q, items: [] };

  const { table, postings, lengths } = await loadSearchIndex();
  const total = lengths.length;
  const average = lengths.reduce((sum, n) => sum + n, 0) / total;
  const scores = new Map<number, number>();
  for (const term of new Set(ftsTokens(words.join(" ")))) {
    const list = postings.get(term) ?? [];
    const idf = Math.log10((total - list.length + 0.5) / (list.length + 0.5) + 1);
    for (const [doc, tf] of list) {
      const weight = (tf * 2.2) / (tf + 1.2 * (0.25 + (0.75 * lengths[doc]!) / average));
      scores.set(doc, (scores.get(doc) ?? 0) + idf * weight);
    }
  }

  const families = table.fund_family_id!;
  const codes = table.scheme_code as string[];
  const family = (doc: number) => (families[doc] ?? codes[doc]) as string;
  const best = new Map<string, number>();
  for (const [doc, score] of scores) {
    best.set(family(doc), Math.max(best.get(family(doc)) ?? -Infinity, score));
  }
  const plans = table.clean_plan!;
  const options = table.clean_option!;
  const names = table.scheme_name as string[];
  // Keep a fund's variants together and lead with Direct Growth, unless a variant was named.
  const variant = words.some((w) => VARIANT_WORDS.has(w))
    ? () => [0]
    : (doc: number) => [
        plans[doc] === "Direct" && options[doc] === "Growth" ? 0 : 1,
        plans[doc] === "Direct" ? 0 : 1,
        options[doc] === "Growth" ? 0 : 1,
      ];
  const key = (doc: number): Value[] => [
    -best.get(family(doc))!,
    family(doc),
    ...variant(doc),
    -scores.get(doc)!,
    names[doc]!,
    codes[doc]!,
  ];
  const ranked = [...scores.keys()]
    .map((doc) => ({ doc, key: key(doc) }))
    .sort((a, b) => {
      for (let i = 0; i < a.key.length; i++) {
        const order = compare(a.key[i]!, b.key[i]!);
        if (order) return order;
      }
      return 0;
    });
  return {
    query: q,
    items: ranked.slice(0, limit).map(({ doc }) => pick(table, SEARCH_FIELDS, doc)),
  };
}
