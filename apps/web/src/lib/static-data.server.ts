import "server-only";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { cache } from "react";
import { decodeColumn, type Column } from "./static-data";

// `next build` and `next dev` both run from apps/web.
const DATA_DIR = path.join(process.cwd(), "public", "data");

/**
 * The build-time twin of `loadJson` in static-data.ts, reading the same files from
 * disk. Memoised per render, so a fund page's getters parse its bundle once.
 */
export const loadJson = cache(
  async <T>(file: string): Promise<T> =>
    JSON.parse(await readFile(path.join(DATA_DIR, file), "utf8")) as T,
) as <T>(file: string) => Promise<T>;

/** Every scheme code with a fund file: the sample export has a few hundred, production all. */
export const exportedFundCodes = async () =>
  (await readdir(path.join(DATA_DIR, "fund")))
    .filter((name) => name.endsWith(".json"))
    .map((name) => name.slice(0, -".json".length));

export const loadScreenColumn = (name: string): Promise<unknown[]> =>
  loadJson<Column>(`screen/${name}.json`).then(decodeColumn);
