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

export function SiteNav() {
  const { t } = useI18n();
  const pathname = splitLocale(usePathname()).path;
  return (
    <nav
      aria-label={t.nav.label}
      className="-mx-1 order-last flex w-full gap-1 overflow-x-auto text-sm lg:order-none lg:mx-0 lg:w-auto"
    >
      {NAV.map(([href, key]) => {
        const current = pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            key={href}
            href={href}
            aria-current={current ? "page" : undefined}
            className={`shrink-0 rounded-full px-3 py-1.5 whitespace-nowrap transition-colors ${
              current
                ? "bg-accent-500/10 font-medium text-accent-600"
                : "text-ink-700 hover:bg-ink-900/5 hover:text-ink-900"
            }`}
          >
            {t.nav[key]}
          </Link>
        );
      })}
    </nav>
  );
}
