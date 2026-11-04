import type { Metadata } from "next";

/** Canonical origin for the sitemap, robots.txt and absolute metadata URLs. */
export const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://screener.manyxlabs.com";

export const SITE_NAME = "MF Screener";

/**
 * A page's title, description, canonical URL and social cards. `path` carries the trailing
 * slash every route is served with, so the canonical is the URL that answers 200 rather
 * than a redirect. A page's openGraph replaces its layout's whole, so the shared card
 * image is set here rather than once in the layout.
 */
export function pageMetadata(
  path: string,
  title: string | { absolute: string },
  description: string,
): Metadata {
  const social = { title: typeof title === "string" ? title : title.absolute, description };
  return {
    title,
    description,
    alternates: { canonical: path },
    openGraph: {
      ...social,
      url: path,
      siteName: SITE_NAME,
      type: "website",
      locale: "en_IN",
      // A screenshot of the home page, 1200 by 630.
      images: { url: "/og.png", width: 1200, height: 630, alt: "MF Screener home page" },
    },
    // X falls back to the og: title and description; repeating them costs every fund page.
    twitter: { card: "summary_large_image" },
  };
}
