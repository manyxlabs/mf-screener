import type { MetadataRoute } from "next";
import { getMetadata } from "@/lib/api";
import { categoryPages, categoryPath } from "@/lib/categories";
import { localePath, LOCALES } from "@/lib/i18n/locales";
import { languageAlternates, SITE_URL } from "@/lib/site";
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
  // Every language's copy of a page is an entry of its own, each listing all of them.
  const translated = (path: string, modified?: string) => {
    const languages = Object.fromEntries(
      Object.entries(languageAlternates(path)).map(([code, href]) => [code, `${SITE_URL}${href}`]),
    );
    return LOCALES.map((locale) => ({
      url: `${SITE_URL}${localePath(locale, path)}`,
      lastModified: modified,
      alternates: { languages },
    }));
  };
  return [
    ...PAGES.flatMap((path) => translated(path)),
    ...categories.map(categoryPath).flatMap((path) => translated(path, lastModified)),
    ...codes.map((code) => ({ url: `${SITE_URL}/fund/${code}/`, lastModified })),
  ];
}
