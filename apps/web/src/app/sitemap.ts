import type { MetadataRoute } from "next";
import { getMetadata } from "@/lib/api";
import { categoryPages, categoryPath } from "@/lib/categories";
import { SITE_URL } from "@/lib/site";
import { exportedFundCodes } from "@/lib/static-data.server";

export const dynamic = "force-static";

const PAGES = [
  "/",
  "/screener/",
  "/category/",
  "/compare/",
  "/basket/",
  "/portfolio/",
  "/capital-gains/",
  "/overlap/",
  "/glossary/",
  "/methodology/",
  "/benchmarks/",
  "/data-status/",
];

// Trailing slashes match `trailingSlash: true`, so every URL listed is the canonical one.
// Fund and category pages change with each NAV refresh, so they carry its date.
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [codes, categories, { coverage }] = await Promise.all([
    exportedFundCodes(),
    categoryPages(),
    getMetadata(),
  ]);
  const lastModified = coverage.latest_nav_date ?? undefined;
  return [
    ...PAGES.map((path) => ({ url: `${SITE_URL}${path}` })),
    ...[...categories.map(categoryPath), ...codes.map((code) => `/fund/${code}/`)].map((path) => ({
      url: `${SITE_URL}${path}`,
      lastModified,
    })),
  ];
}
