"use client";

import { usePathname } from "next/navigation";
import Link from "@/components/link";
import { useI18n } from "@/lib/i18n/client";
import { splitLocale } from "@/lib/i18n/locales";

// Benchmarks, data status and overlap are in the footer: the first two are coverage pages
// for whoever maintains the store, and the published site carries no holdings for overlap
// to read. The logo is the way home.
const NAV = [
  ["/screener", "screener"],
  ["/compare", "compare"],
  ["/basket", "basket"],
  ["/portfolio", "checkup"],
  ["/capital-gains", "capitalGains"],
  ["/glossary", "glossary"],
  ["/methodology", "methodology"],
] as const;

/** The navbar menu's links; `onNavigate` closes the menu. */
export function SiteNav({ id, onNavigate }: { id: string; onNavigate: () => void }) {
  const { t } = useI18n();
  const pathname = splitLocale(usePathname()).path;
  return (
    <nav
      id={id}
      aria-label={t.nav.label}
      className="glass mx-auto mt-2 grid max-w-5xl gap-1 rounded-3xl p-2 sm:grid-cols-2 lg:grid-cols-4"
    >
      {NAV.map(([href, key]) => {
        const current = pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            key={href}
            href={href}
            aria-current={current ? "page" : undefined}
            onClick={onNavigate}
            className={`flex items-center gap-2 rounded-2xl px-4 py-3 transition-colors hover:bg-ink-900/5 hover:text-ink-900 ${
              current ? "font-medium text-ink-900" : "text-ink-500"
            }`}
          >
            {t.nav[key]}
            {current ? <span aria-hidden className="size-1.5 rounded-full bg-accent-500" /> : null}
          </Link>
        );
      })}
    </nav>
  );
}
