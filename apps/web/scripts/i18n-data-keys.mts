/**
 * Lists the `data` keys a catalogue needs: every piece of pipeline-written text the site
 * passes through `td`, keyed as `td` looks it up. With catalogues present, prints only the
 * keys each one lacks, so a new pipeline sentence is found before a reader meets English.
 *
 *   node scripts/i18n-data-keys.mts            # every key, as JSON
 *   node scripts/i18n-data-keys.mts --missing  # per language, the keys it does not have
 *   node scripts/i18n-data-keys.mts --review hi  # the wording a native speaker must check
 *
 * Reads public/data, so run it after `make static-export`.
 */
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { dataKey } from "../src/lib/i18n/data-key.ts";
import { LANGUAGES, PREFIXED_LOCALES, type Locale } from "../src/lib/i18n/locales.ts";
import en from "../src/messages/en.ts";
import { dataNeedsReview, REVIEW_PATHS } from "../src/messages/review.ts";

const ROOT = new URL("..", import.meta.url).pathname;
const DATA = join(ROOT, "public/data");
const json = async (path: string) => JSON.parse(await readFile(join(DATA, path), "utf8"));

const keys = new Set<string>();
const add = (text: unknown) => {
  if (typeof text === "string" && /[a-z]/i.test(text)) keys.add(dataKey(text));
};
const humanise = (key: string) => {
  const text = key.replaceAll("_", " ");
  return text.charAt(0).toUpperCase() + text.slice(1);
};
const strings = (value: unknown): unknown[] =>
  value && typeof value === "object" ? Object.values(value).flatMap(strings) : [value];

type Spec = Record<string, string | null>;
const METRIC_FIELDS = ["label", "plain_label", "definition", "plain_definition", "caveat"];
const METRIC_FIELDS_ALL = [...METRIC_FIELDS, "period", "group", "frequency"];

const columns = await json("global/columns.json");
for (const m of columns.metrics as Spec[]) {
  METRIC_FIELDS_ALL.forEach((field) => add(m[field]));
  // The fund page's risk table drops the horizon from the plain label.
  add(m.plain_label?.replace(/\s*\(\d+Y\)$/, ""));
}
Object.values(columns.missing_reasons).forEach(add);

const methodology = await json("global/methodology.json");
for (const field of ["disclaimer", "month_end_rule"]) add(methodology[field]);
[
  methodology.peer_universe_rules,
  methodology.limitations,
  methodology.formula_notes,
  methodology.data_quality_reasons,
  methodology.alpha_significance,
  methodology.score,
].forEach((value) => strings(value).forEach(add));
for (const section of [
  "frequency",
  "peer_universe_default",
  "minimum_observations",
  "benchmarks",
  "sources",
]) {
  for (const [key, value] of Object.entries(methodology[section])) {
    add(humanise(key));
    strings(value).forEach(add);
  }
}
Object.keys(methodology.formulas).forEach((key) => add(humanise(key)));
for (const m of methodology.metric_catalog as Spec[]) METRIC_FIELDS.forEach((f) => add(m[f]));

for (const p of await json("global/presets.json")) {
  ["name", "subtitle", "question", "plain_description", "caution", "description"].forEach((f) =>
    add(p[f]),
  );
}
const facets = await json("global/facets.json");
[...facets.cap_bands, ...facets.styles].forEach(add);
add((await json("global/metadata.json")).disclaimer);
const benchmarks = await json("global/benchmarks.json");
[benchmarks.currency_policy, benchmarks.disclaimer, ...benchmarks.warnings].forEach(add);
benchmarks.mapping_rules.forEach((rule: Spec) => add(rule.notes));

// The static site's own note, which stands in for the API's.
const note = /export const NOTE =\s*((?:"[^"]*"\s*\+?\s*)+);/.exec(
  await readFile(join(ROOT, "src/lib/static-screen.ts"), "utf8"),
);
if (!note) throw new Error("NOTE not found in src/lib/static-screen.ts");
add(
  note[1]
    .match(/"[^"]*"/g)!
    .map((part) => JSON.parse(part))
    .join(""),
);

// Fund bundles: their prose fields wherever they sit, and data-quality flags humanised.
const PROSE = new Set(["description", "reason_description", "caveat", "disclaimer", "detail"]);
const walk = (value: unknown, key = ""): void => {
  if (Array.isArray(value)) value.forEach((item) => walk(item, key));
  else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      if (k === "missing_reason_descriptions") Object.values(v as object).forEach(add);
      else if (k === "data_quality_flags" && Array.isArray(v))
        v.forEach((flag: string) => add(flag.replaceAll("_", " ")));
      else walk(v, k);
    }
  } else if (PROSE.has(key)) add(value);
};
for (const file of await readdir(join(DATA, "fund"))) {
  walk(await json(`fund/${file}`));
}

const sorted = [...keys].sort();
const catalogue = async (locale: Locale) =>
  (await import(join(ROOT, `src/messages/${locale}.ts`))).default;

/** A catalogue value as a reader sees it: arguments as {name}, code between pieces as [...]. */
function show(value: unknown): string {
  if (Array.isArray(value)) return value.map(show).join(" [...] ");
  if (typeof value !== "function") return String(value);
  const names = /^\(?([^)=]*)\)?\s*=>/.exec(String(value))?.[1]?.split(",") ?? [];
  const slot = (name: string): unknown =>
    new Proxy(
      {},
      {
        get: (_, key) =>
          key === Symbol.toPrimitive ? () => `{${name}}` : slot(`${name}.${String(key)}`),
      },
    );
  return show(value(...names.map((name: string) => slot(name.trim()))));
}

const at = (tree: unknown, path: string) =>
  path.split(".").reduce<unknown>((node, key) => (node as Record<string, unknown>)?.[key], tree);

/** Every entry under a gated path, one per string or function. */
const entries = (tree: unknown, path: string): string[] => {
  const node = at(tree, path);
  return node && typeof node === "object" && !Array.isArray(node)
    ? Object.keys(node).flatMap((key) => entries(tree, `${path}.${key}`))
    : [path];
};

const mode = process.argv[2];
if (mode === "--missing") {
  for (const locale of PREFIXED_LOCALES) {
    const { data } = await catalogue(locale);
    const missing = sorted.filter((key) => !(key in data));
    console.log(`${locale}: ${missing.length} missing`);
    missing.forEach((key) => console.log(`  ${key}`));
  }
} else if (mode === "--review") {
  const locale = process.argv[3] as Locale;
  if (!PREFIXED_LOCALES.includes(locale))
    throw new Error(`--review needs one of ${PREFIXED_LOCALES}`);
  const t = await catalogue(locale);
  const name = LANGUAGES[locale].name;
  const item = (label: string, english: string, translated: string) =>
    `### ${label}\n\n- English: ${english}\n- ${name}: ${translated}\n- [ ] Checked\n`;
  const ui = REVIEW_PATHS.flatMap((path) => entries(en, path));
  const data = sorted.filter(dataNeedsReview);
  console.log(
    [
      `# ${name} (${locale}): wording to check before it launches`,
      "",
      `These ${ui.length + data.length} entries show in English on the ${name} pages until every one is checked.`,
      "Check that each says the same as the English, with nothing softened, added or left out, in words an investor reading this language would use.",
      `When all are checked, set \`reviewed: true\` for ${locale} in apps/web/src/lib/i18n/locales.ts.`,
      "{name} is a value filled in on the page, and [...] is where a link or a code snippet sits.",
      "",
      `## Interface text (${ui.length})`,
      "",
      ...ui.map((path) => item(`\`${path}\``, show(at(en, path)), show(at(t, path)))),
      `## Text from the data pipeline (${data.length})`,
      "",
      "{0}, {1}, ... stand for numbers that change with each nightly rebuild.",
      "",
      ...data.map((key, i) =>
        item(`Data ${i + 1}`, key, t.data[key] ?? "(missing: shows English)"),
      ),
    ].join("\n"),
  );
} else {
  console.log(JSON.stringify(sorted, null, 2));
}
