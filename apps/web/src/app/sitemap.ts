import type { MetadataRoute } from "next";
import { exportedFundCodes } from "@/lib/static-data.server";
import { SITE_URL } from "@/lib/site";

export const dynamic = "force-static";

const PAGES = [
  "",
  "screener",
  "compare",
  "basket",
  "overlap",
  "glossary",
  "methodology",
  "benchmarks",
  "data-status",
];

// Trailing slashes match `trailingSlash: true`, so every URL listed is the canonical one.
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const funds = (await exportedFundCodes()).map((code) => `fund/${code}`);
  return [...PAGES, ...funds].map((path) => ({ url: `${SITE_URL}/${path}${path && "/"}` }));
}
