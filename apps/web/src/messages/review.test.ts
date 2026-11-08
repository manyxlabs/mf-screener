import { describe, expect, it } from "vitest";
import en from "./en";
import { REVIEW_PATHS } from "./review";

const ADVICE = /advice|guarantee|forecast|not a recommendation/i;

function leaves(value: unknown, path: string): [string, string][] {
  if (typeof value === "string" || typeof value === "function") return [[path, String(value)]];
  if (value && typeof value === "object")
    return Object.entries(value).flatMap(([k, v]) => leaves(v, path ? `${path}.${k}` : k));
  return [];
}

describe("review gate", () => {
  it("holds back every disclaimer until its language is reviewed", () => {
    const gated = (path: string) =>
      REVIEW_PATHS.some((p) => path === p || path.startsWith(`${p}.`));
    const ungated = leaves({ ...en, data: undefined }, "")
      .filter(([path, text]) => ADVICE.test(text) && !gated(path))
      .map(([path]) => path);
    expect(ungated).toEqual([]);
  });
});
