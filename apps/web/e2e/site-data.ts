import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

/**
 * A file of the site's data, from the deployed site when BASE_URL names one, so the figures
 * a spec expects come from the same day's NAVs as the pages it checks. Throws when absent.
 */
export function siteData(path: string): unknown {
  const base = process.env.BASE_URL;
  const text = base
    ? execFileSync("curl", ["-fsS", new URL(`/data/${path}`, base).href], { maxBuffer: 1 << 28 })
    : readFileSync(`public/data/${path}`);
  return JSON.parse(text.toString());
}
