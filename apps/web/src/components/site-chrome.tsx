"use client";

import Link from "@/components/link";
import { LanguageSwitcher } from "@/components/language-switcher";
import { SchemeSearch } from "@/components/scheme-search";
import { SiteNav } from "@/components/site-nav";
import { ThemeToggle } from "@/components/theme-toggle";
import { useI18n } from "@/lib/i18n/client";

// Client components, so a single-URL page can switch their language in place.

function Logo() {
  return (
    <Link href="/" className="flex shrink-0 items-center gap-2 font-semibold tracking-tight">
      {/* eslint-disable-next-line @next/next/no-img-element -- a 24px static SVG gains nothing from next/image */}
      <img src="/icon.svg" alt="" width={24} height={24} className="rounded-md" />
      MF Screener
    </Link>
  );
}

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 px-3 pt-3 sm:px-4 print:static">
      <div className="glass mx-auto flex max-w-[1600px] flex-wrap items-center gap-x-6 gap-y-2 rounded-2xl px-3 py-2 sm:px-4">
        <Logo />
        <SiteNav />
        <div className="ml-auto flex min-w-0 flex-1 items-center justify-end gap-2 lg:flex-none">
          <SchemeSearch />
          <LanguageSwitcher />
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}

const REPO = "https://github.com/manyxlabs/mf-screener";

export function SiteFooter({
  latestNav,
  metricsAsOf,
}: {
  latestNav: string | null;
  metricsAsOf: string | null;
}) {
  const { t } = useI18n();
  const f = t.footer;
  const groups = [
    [
      f.tools,
      [
        [t.nav.screener, "/screener"],
        [f.categories, "/category"],
        [f.compare, "/compare"],
        [f.basket, "/basket"],
        [f.checkup, "/portfolio"],
        [f.capitalGains, "/capital-gains"],
        [f.overlap, "/overlap"],
      ],
    ],
    [
      f.learn,
      [
        [t.nav.glossary, "/glossary"],
        [t.nav.methodology, "/methodology"],
        [f.benchmarks, "/benchmarks"],
        [f.dataStatus, "/data-status"],
      ],
    ],
    [
      f.project,
      [
        [f.source, REPO],
        [f.issue, `${REPO}/issues/new`],
        [f.contribute, `${REPO}/blob/main/CONTRIBUTING.md`],
        ["Manyx Labs", "https://www.manyxlabs.com/"],
      ],
    ],
  ] as const;
  return (
    <footer className="mt-16 border-t border-ink-200 bg-surface/40 print:hidden">
      <div className="mx-auto grid max-w-[1600px] gap-10 px-4 py-12 sm:px-6 md:grid-cols-[1.4fr_repeat(3,1fr)]">
        <div className="space-y-3">
          <Logo />
          <p className="max-w-sm text-sm text-ink-500">{f.blurb}</p>
        </div>
        {groups.map(([title, links]) => (
          <nav key={title} aria-label={title}>
            <h2 className="text-sm font-semibold text-ink-900">{title}</h2>
            <ul className="mt-3 space-y-2 text-sm">
              {links.map(([label, href]) => (
                <li key={href}>
                  {href.startsWith("http") ? (
                    <a
                      className="text-ink-500 hover:text-ink-900"
                      href={href}
                      target="_blank"
                      rel="noopener"
                    >
                      {label}
                    </a>
                  ) : (
                    <Link className="text-ink-500 hover:text-ink-900" href={href}>
                      {label}
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          </nav>
        ))}
      </div>
      <div className="border-t border-ink-200">
        <div className="mx-auto max-w-[1600px] space-y-2 px-4 py-6 text-xs text-ink-500 sm:px-6">
          <p className="font-medium text-ink-700">{t.common.disclaimer}</p>
          <p>
            {f.asOf(latestNav ?? "-", metricsAsOf ?? "-")} {f.attribution}
          </p>
        </div>
      </div>
    </footer>
  );
}
