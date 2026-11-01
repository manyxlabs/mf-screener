// @vitest-environment node
/**
 * What the parity run (static-screen.parity.test.ts, which needs a live API) cannot show
 * in CI: that a screen downloads only the columns it uses, and Python's float spellings
 * the current export happens not to contain.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { exportCsv, screen } from "./static-screen";

const FILES: Record<string, unknown> = {
  "global/columns.json": {
    default: ["scheme_name", "scheme_code", "cagr_5y"],
    selectable: ["scheme_name", "scheme_code", "cagr_5y", "alpha_pvalue_3y"],
    sortable: ["scheme_name", "cagr_5y", "alpha_pvalue_3y"],
    metrics: [{ name: "cagr_5y" }, { name: "alpha_pvalue_3y" }],
  },
  "global/metadata.json": {
    coverage: { metrics_as_of: "2026-09-30" },
    methodology_version: "1.0.0",
    default_universe: { level: "sub_category", min_peers: 5 },
    disclaimer: "Not advice.",
  },
  "global/methodology.json": { risk_free_rate: { annual: 0.065 } },
  "screen/scheme_code.json": ["1", "2", "3", "4"],
  "screen/scheme_name.json": ["A", "B", "C", "D"],
  "screen/clean_plan.json": ["Direct", "Direct", "Direct", "Direct"],
  "screen/clean_option.json": ["Growth", "Growth", "Growth", "Growth"],
  "screen/fund_family_id.json": ["f1", "f2", "f3", "f4"],
  "screen/cagr_5y.json": [0.12, 3, null, 2.5],
  // As Python writes it: JSON.stringify would drop the sign of -0.0.
  "screen/alpha_pvalue_3y.json": "[1e-05,1.5e+16,-0.0,0.0001]",
};
const fetched: string[] = [];

beforeAll(() => {
  vi.stubGlobal("fetch", async (url: string) => {
    const path = url.replace(/^\/data\//, "");
    fetched.push(path);
    return path in FILES
      ? new Response(typeof FILES[path] === "string" ? FILES[path] : JSON.stringify(FILES[path]))
      : new Response(null, { status: 404 });
  });
});
afterAll(() => vi.unstubAllGlobals());

describe("static screen", () => {
  it("fetches only the columns a screen filters, ranks, sorts or shows", async () => {
    const result = await screen("columns=cagr_5y&sort=cagr_5y:desc");
    expect(result.rows.map((r) => r.scheme_code)).toEqual(["2", "4", "1", "3"]);
    expect(fetched.filter((p) => p.startsWith("screen/")).sort()).toEqual([
      "screen/cagr_5y.json",
      "screen/clean_option.json",
      "screen/clean_plan.json",
      "screen/fund_family_id.json",
      "screen/scheme_code.json",
      "screen/scheme_name.json",
    ]);
  });

  it("writes floats as Python does, whole ones included", async () => {
    const csv = await exportCsv("columns=cagr_5y,alpha_pvalue_3y&sort=scheme_name:asc");
    expect(csv.split("\n").slice(4, 8)).toEqual([
      "A,1,0.12,1e-05",
      "B,2,3.0,1.5e+16",
      "C,3,,-0.0",
      "D,4,2.5,0.0001",
    ]);
  });
});
