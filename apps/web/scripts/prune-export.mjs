// Next 16 writes each page's full RSC payload twice (index.txt and __next._full.txt)
// beside the per-segment files its router actually fetches. Across the ~8,700 fund pages
// those copies come to about 300 MB, which pushes the site past GitHub Pages' 1 GB limit.
// The E2E suite navigates client-side into fund and tool pages with them removed.
import { readdir, rm } from "node:fs/promises";
import path from "node:path";

const OUT = path.join(import.meta.dirname, "..", "out");
const UNUSED = new Set(["index.txt", "__next._full.txt"]);

let removed = 0;
for (const entry of await readdir(OUT, { recursive: true, withFileTypes: true })) {
  if (entry.isFile() && UNUSED.has(entry.name)) {
    await rm(path.join(entry.parentPath, entry.name));
    removed++;
  }
}
// None found means Next changed its output layout, and this script needs a second look.
if (!removed) throw new Error(`No ${[...UNUSED].join(" or ")} under ${OUT}`);
console.log(`Removed ${removed} unused RSC payload copies`);
