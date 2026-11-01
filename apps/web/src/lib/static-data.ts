/**
 * Reads the JSON that `make static-export` writes to `public/data`, which replaces the
 * live API on the published site. Each file is fetched once per page load.
 */
const DATA_BASE = process.env.NEXT_PUBLIC_DATA_BASE ?? "/data";

const cache = new Map<string, Promise<unknown>>();

export function loadJson<T>(path: string): Promise<T> {
  let hit = cache.get(path);
  if (!hit) {
    hit = fetch(`${DATA_BASE}/${path}`).then((response) => {
      if (!response.ok) throw new Error(`${path}: ${response.status}`);
      return response.json();
    });
    // A failed fetch is not remembered, so a retry can succeed.
    hit.catch(() => cache.delete(path));
    cache.set(path, hit);
  }
  return hit as Promise<T>;
}

/** The screener table, one array per column, all aligned by row. */
export type ScreenIndex = { columns: string[]; count: number };

export const loadScreenIndex = () => loadJson<ScreenIndex>("screen/index.json");
export const loadScreenColumn = (name: string) => loadJson<unknown[]>(`screen/${name}.json`);

/** One fund's answers, keyed as in `FUND` in static_export.py; a refusal is `{error, detail}`. */
export type FundBundle = Record<string, unknown>;
export const loadFund = (code: string) => loadJson<FundBundle>(`fund/${code}.json`);
