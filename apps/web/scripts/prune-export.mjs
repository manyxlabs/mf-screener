// Next 16 writes each page's full RSC payload twice (index.txt and __next._full.txt)
// beside the per-segment files its router actually fetches. Across the ~8,700 fund pages
// those copies come to about 300 MB, which pushes the site past GitHub Pages' 1 GB limit.
// Only fund pages are pruned: the router fetches index.txt when it navigates to a page it
// has not prefetched (home to /screener/ does), and without it falls back to a full reload.
// That fallback is acceptable on fund pages, where the size is, but not across the tools.
import { readdir, rm } from "node:fs/promises";
import path from "node:path";

const OUT = path.join(import.meta.dirname, "..", "out");
const FUNDS = path.join(OUT, "fund");
const UNUSED = new Set(["index.txt", "__next._full.txt"]);

let removed = 0;
for (const entry of await readdir(FUNDS, { recursive: true, withFileTypes: true })) {
  if (entry.isFile() && UNUSED.has(entry.name)) {
    await rm(path.join(entry.parentPath, entry.name));
    removed++;
  }
}
// None found means Next changed its output layout, and this script needs a second look.
if (!removed) throw new Error(`No ${[...UNUSED].join(" or ")} under ${FUNDS}`);
console.log(`Removed ${removed} unused RSC payload copies`);
