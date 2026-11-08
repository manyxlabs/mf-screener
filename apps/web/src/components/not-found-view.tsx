"use client";

import Link from "@/components/link";
import { useI18n } from "@/lib/i18n/client";

/** Client-side because a not-found page gets no params: it reads the language from the layout. */
export function NotFoundView() {
  const { t } = useI18n();
  const links = [
    [t.common.home, "/"],
    [t.nav.screener, "/screener/"],
    [t.footer.categories, "/category/"],
    [t.footer.compare, "/compare/"],
  ] as const;
  return (
    <div className="mx-auto max-w-xl space-y-4 py-16 text-center">
      <p className="text-sm font-medium text-accent-600 numeric">404</p>
      <h1 className="text-2xl font-semibold tracking-tight text-ink-900">{t.notFound.heading}</h1>
      <p className="text-sm text-pretty text-ink-700">{t.notFound.body}</p>
      <ul className="flex flex-wrap justify-center gap-2 text-sm">
        {links.map(([label, href]) => (
          <li key={href}>
            <Link
              href={href}
              className="inline-block rounded-full border border-ink-200 bg-surface/70 px-3 py-1 text-ink-700 shadow-sm hover:border-accent-500 hover:text-accent-600"
            >
              {label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
