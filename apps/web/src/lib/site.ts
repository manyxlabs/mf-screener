import type { Metadata } from "next";
import type { I18n } from "./i18n/core";
import { DEFAULT_LOCALE, isSingleUrlPath, localePath, LOCALES } from "./i18n/locales";

/** Canonical origin for the sitemap, robots.txt and absolute metadata URLs. */
export const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://screener.manyxlabs.com";

export const SITE_NAME = "MF Screener";

/** hreflang alternates for an English path: every language, and English as x-default. */
export const languageAlternates = (path: string) =>
  Object.fromEntries([
    ...LOCALES.map((locale) => [locale, localePath(locale, path)]),
    ["x-default", localePath(DEFAULT_LOCALE, path)],
  ]);

/**
 * A page's title, description, canonical URL, language alternates and social cards.
 * `path` is the English path, with the trailing slash every route is served with, so
 * the canonical is the URL that answers 200 rather than a redirect. A page's openGraph
 * replaces its layout's whole, so the shared card image is set here rather than once in
 * the layout.
 */
export function pageMetadata(
  { locale, t }: I18n,
  path: string,
  title: string | { absolute: string },
  description: string,
): Metadata {
  const url = localePath(locale, path);
  const social = { title: typeof title === "string" ? title : title.absolute, description };
  return {
    title,
    description,
    // A single-URL page has no other-language copy to point at.
    alternates: isSingleUrlPath(path)
      ? { canonical: url }
      : { canonical: url, languages: languageAlternates(path) },
    openGraph: {
      ...social,
      url,
      siteName: SITE_NAME,
      type: "website",
      locale: `${locale}_IN`,
      // A screenshot of the home page, 1200 by 630.
      images: { url: "/og.png", width: 1200, height: 630, alt: t.meta.ogImageAlt },
    },
    // X falls back to the og: title and description; repeating them costs every fund page.
    twitter: { card: "summary_large_image" },
  };
}
