"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// Benchmarks, data status and overlap are in the footer: the first two are coverage pages
// for whoever maintains the store, and the published site carries no holdings for overlap
// to read. The logo is the way home.
const NAV = [
  { href: "/screener", label: "Screener" },
  { href: "/compare", label: "Compare" },
  { href: "/basket", label: "Basket" },
  { href: "/portfolio", label: "Checkup" },
  { href: "/capital-gains", label: "Capital gains" },
  { href: "/glossary", label: "Glossary" },
  { href: "/methodology", label: "Methodology" },
];

export function SiteNav() {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Main"
      className="-mx-1 order-last flex w-full gap-1 overflow-x-auto text-sm lg:order-none lg:mx-0 lg:w-auto"
    >
      {NAV.map((item) => {
        const current = pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={current ? "page" : undefined}
            className={`shrink-0 rounded-full px-3 py-1.5 whitespace-nowrap transition-colors ${
              current
                ? "bg-accent-500/10 font-medium text-accent-600"
                : "text-ink-700 hover:bg-ink-900/5 hover:text-ink-900"
            }`}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
