/**
 * Lists the `data` keys a catalogue needs: every piece of pipeline-written text the site
 * passes through `td`, keyed as `td` looks it up. With catalogues present, prints only the
 * keys each one lacks, so a new pipeline sentence is found before a reader meets English.
 *
 *   node scripts/i18n-data-keys.mts            # every key, as JSON
 *   node scripts/i18n-data-keys.mts --missing  # per language, the keys it does not have
 *
 * Reads public/data, so run it after `make static-export`.
 */
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { dataKey } from "../src/lib/i18n/data-key.ts";

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
if (process.argv.includes("--missing")) {
  const dir = join(ROOT, "src/messages");
  for (const file of (await readdir(dir)).filter((f) => f !== "en.ts").sort()) {
    const { data } = (await import(join(dir, file))).default;
    const missing = sorted.filter((key) => !(key in data));
    console.log(`${file.replace(".ts", "")}: ${missing.length} missing`);
    missing.forEach((key) => console.log(`  ${key}`));
  }
} else {
  console.log(JSON.stringify(sorted, null, 2));
}
