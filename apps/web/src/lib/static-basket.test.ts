// @vitest-environment node
/**
 * Parity with the live POST /basket over an export of the same store:
 *   MF_PARITY_API=http://127.0.0.1:8102 MF_PARITY_DATA=/tmp/basket-data pnpm test static-basket
 * Writes every case and its largest relative and absolute gaps to MF_PARITY_DATA/parity.json.
 */
import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { ApiError } from "./api";
import { basket } from "./static-basket";

const API = process.env.MF_PARITY_API;
const DATA = process.env.MF_PARITY_DATA;
// 6 significant figures. The export also rounds every input to 6, which a figure that
// cancels towards zero (a near-zero correlation or blended month) cannot keep, so a run
// over a rounded export passes MF_PARITY_ABS as well; an unrounded one needs neither.
const REL_TOLERANCE = 1e-6;
const ABS_TOLERANCE = Number(process.env.MF_PARITY_ABS ?? 0);

type Case = { name: string; codes: string[]; weights?: number[] };
type Outcome = { status: number; body: unknown };

const realFetch = globalThis.fetch;

async function viaApi({ codes, weights }: Case): Promise<Outcome> {
  const response = await realFetch(`${API}/basket`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(weights ? { scheme_codes: codes, weights } : { scheme_codes: codes }),
  });
  const body = (await response.json()) as { detail?: string | { msg: string }[] };
  if (response.ok) return { status: 200, body };
  const detail = body.detail!;
  return { status: response.status, body: typeof detail === "string" ? detail : detail[0]!.msg };
}

async function viaStatic({ codes, weights }: Case): Promise<Outcome> {
  try {
    return { status: 200, body: await basket(codes, weights) };
  } catch (error) {
    if (!(error instanceof ApiError)) throw error;
    return { status: error.status, body: error.message };
  }
}

type Diff = { rel: number; abs: number; mismatches: string[] };

/** Accumulates the largest relative and absolute gaps; any shape difference is a mismatch. */
function diff(a: unknown, b: unknown, path: string, out: Diff): void {
  if (typeof a === "number" && typeof b === "number") {
    const abs = Math.abs(a - b);
    const scale = Math.max(Math.abs(a), Math.abs(b));
    out.abs = Math.max(out.abs, abs);
    out.rel = Math.max(out.rel, scale === 0 ? 0 : abs / scale);
    if (abs > REL_TOLERANCE * scale + ABS_TOLERANCE) out.mismatches.push(`${path}: ${a} vs ${b}`);
  } else if (Array.isArray(a) && Array.isArray(b) && a.length === b.length) {
    a.forEach((x, i) => diff(x, b[i], `${path}[${i}]`, out));
  } else if (
    a &&
    b &&
    typeof a === "object" &&
    typeof b === "object" &&
    !Array.isArray(a) &&
    // Key order is not compared: JS puts numeric-looking keys first in ascending order.
    Object.keys(a).sort().join() === Object.keys(b).sort().join()
  ) {
    for (const k of Object.keys(a))
      diff(
        (a as Record<string, unknown>)[k],
        (b as Record<string, unknown>)[k],
        `${path}.${k}`,
        out,
      );
  } else if (a !== b) {
    out.mismatches.push(`${path}: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`);
  }
}

/** Deterministic so a failing basket can be rerun. */
function random(seed: number) {
  return () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
}

async function cases(): Promise<Case[]> {
  const files = (await readdir(join(DATA!, "fund"))).map((f) => f.replace(".json", ""));
  const months = new Map(
    await Promise.all(
      files.map(async (code) => {
        const bundle = JSON.parse(await readFile(join(DATA!, "fund", `${code}.json`), "utf8"));
        return [code, bundle.monthly_returns.dates.length as number] as const;
      }),
    ),
  );
  const long = files.filter((c) => months.get(c)! >= 60);
  const short = files.filter((c) => months.get(c)! < 24);
  const rand = random(7);
  const pick = (pool: string[], n: number) => [...pool].sort(() => rand() - 0.5).slice(0, n);
  const normalised = (raw: number[]) => raw.map((w) => w / raw.reduce((a, b) => a + b, 0));

  const named = {
    ppfas: "122639",
    hdfcFlexi: "118955",
    nipponSmall: "118778",
    utiNifty: "120716",
    miraeLarge: "118825",
    icicLiquid: "120197",
    hdfcCorpBond: "118987",
    nipponGold: "118663",
    hdfcBaf: "118968",
  };
  const out: Case[] = [
    ...files.map((code) => ({ name: `solo ${code}`, codes: [code] })),
    { name: "flexi pair", codes: [named.ppfas, named.hdfcFlexi] },
    { name: "flexi pair uneven", codes: [named.ppfas, named.hdfcFlexi], weights: [0.7, 0.3] },
    { name: "index vs large cap", codes: [named.utiNifty, named.miraeLarge] },
    {
      name: "equity, debt, gold",
      codes: [named.nipponSmall, named.hdfcCorpBond, named.nipponGold],
    },
    {
      name: "liquid vs small cap",
      codes: [named.icicLiquid, named.nipponSmall],
      weights: [0.2, 0.8],
    },
    { name: "all named", codes: Object.values(named) },
    { name: "zero weight", codes: [named.ppfas, named.hdfcBaf], weights: [1, 0] },
    {
      name: "zero weights",
      codes: [named.ppfas, named.hdfcBaf, named.utiNifty],
      weights: [0, 0, 1],
    },
    { name: "unsorted codes", codes: [named.utiNifty, named.ppfas, named.icicLiquid] },
    {
      name: "sum within tolerance",
      codes: [named.ppfas, named.utiNifty],
      weights: [0.5, 0.5000005],
    },
    { name: "sum off", codes: [named.ppfas, named.utiNifty], weights: [0.5, 0.6] },
    { name: "sum small", codes: [named.ppfas, named.utiNifty], weights: [0.2, 0.2] },
    { name: "negative", codes: [named.ppfas, named.utiNifty], weights: [1.5, -0.5] },
    { name: "too few weights", codes: [named.ppfas, named.utiNifty], weights: [1] },
    { name: "empty weights", codes: [named.ppfas], weights: [] },
    { name: "NaN weight", codes: [named.ppfas, named.utiNifty], weights: [NaN, 1] },
    { name: "no codes", codes: [] },
    { name: "duplicate", codes: [named.ppfas, named.ppfas] },
    { name: "duplicate with bad weights", codes: [named.ppfas, named.ppfas], weights: [1] },
    { name: "eleven", codes: pick(long, 11) },
    { name: "eleven duplicated", codes: Array(11).fill(named.ppfas) },
    { name: "unknown", codes: ["999999999"] },
    { name: "unknown after known", codes: [named.ppfas, "000000", "999999999"] },
    { name: "unknown with bad weights", codes: ["999999999"], weights: [2] },
    { name: "long with short", codes: [named.ppfas, short[0]!] },
    { name: "no returns at all", codes: [named.ppfas, "148397"] },
    { name: "two without returns", codes: ["148397", "148398"] },
    { name: "gappy young", codes: ["148916", "152665"] },
    { name: "gappy with old", codes: ["148916", named.hdfcFlexi] },
  ];
  for (let i = 0; i < 60; i++) {
    const n = 2 + (i % 9);
    const codes = pick(i % 4 === 3 ? files : long, n);
    const weights = i % 2 ? normalised(codes.map(() => rand())) : undefined;
    out.push({ name: `random ${i}`, codes, weights });
  }
  return out;
}

describe.skipIf(!API || !DATA)("basket parity with the live API", () => {
  it("answers every basket as POST /basket does", { timeout: 300_000 }, async () => {
    vi.stubGlobal("fetch", async (url: string) => {
      try {
        return new Response(await readFile(join(DATA!, url.replace(/^\/data\//, ""))));
      } catch {
        return new Response(null, { status: 404 });
      }
    });
    const report = [];
    for (const c of await cases()) {
      const [expected, actual] = await Promise.all([viaApi(c), viaStatic(c)]);
      const gap: Diff = { rel: 0, abs: 0, mismatches: [] };
      diff(actual, expected, "", gap);
      report.push({ ...c, status: expected.status, ...gap });
    }
    await writeFile(join(DATA!, "parity.json"), JSON.stringify(report, null, 1));
    const failed = report.filter((r) => r.mismatches.length);
    expect(failed).toEqual([]);
    const statuses: Record<string, number> = {};
    for (const r of report) statuses[r.status] = (statuses[r.status] ?? 0) + 1;
    const rel = Math.max(...report.map((r) => r.rel));
    const abs = Math.max(...report.map((r) => r.abs));
    console.log(
      `${report.length} baskets, statuses ${JSON.stringify(statuses)}, max gap rel ${rel} abs ${abs}`,
    );
  });
});
