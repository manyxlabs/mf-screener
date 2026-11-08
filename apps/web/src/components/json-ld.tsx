"use client";

import Link from "@/components/link";
import { useI18n } from "@/lib/i18n/client";
import { SITE_URL } from "@/lib/site";

/** `<` is escaped so a scheme name can never close the script element early. */
export function JsonLd({ data }: { data: Record<string, unknown> }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{
        __html: JSON.stringify({ "@context": "https://schema.org", ...data }).replace(
          /</g,
          "\\u003c",
        ),
      }}
    />
  );
}

/**
 * The visible trail and its BreadcrumbList, after the home page; the last entry is the
 * current page. Paths are English: each is served in the page's language.
 */
export function Breadcrumbs({ trail: rest }: { trail: [name: string, path: string][] }) {
  const { t, href } = useI18n();
  const trail: [string, string][] = [[t.common.home, "/"], ...rest];
  return (
    <nav aria-label={t.common.breadcrumb} className="text-sm text-ink-500">
      <JsonLd
        data={{
          "@type": "BreadcrumbList",
          itemListElement: trail.map(([name, path], index) => ({
            "@type": "ListItem",
            position: index + 1,
            name,
            item: `${SITE_URL}${href(path)}`,
          })),
        }}
      />
      <ol className="flex flex-wrap gap-x-1.5 gap-y-1">
        {trail.map(([name, path], index) => (
          <li key={path} className="min-w-0 truncate">
            {index ? <span aria-hidden="true">/ </span> : null}
            {index === trail.length - 1 ? (
              <span aria-current="page" className="text-ink-700">
                {name}
              </span>
            ) : (
              <Link href={path} className="hover:text-ink-900 hover:underline">
                {name}
              </Link>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}
