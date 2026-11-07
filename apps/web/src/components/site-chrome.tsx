"use client";

import { useEffect, useId, useRef, useState } from "react";
import Link from "@/components/link";
import { LanguageSwitcher } from "@/components/language-switcher";
import { SchemeSearch } from "@/components/scheme-search";
import { SiteNav } from "@/components/site-nav";
import { ThemeToggle } from "@/components/theme-toggle";
import { useI18n } from "@/lib/i18n/client";

// Client components, so a single-URL page can switch their language in place.

/** `compact` keeps the name for screen readers only, so a phone's navbar has room to search. */
function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <Link
      href="/"
      className="flex shrink-0 items-center gap-2 text-lg font-semibold tracking-tight"
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- a 24px static SVG gains nothing from next/image */}
      <img src="/icon.svg" alt="" width={24} height={24} className="rounded-md" />
      <span className={compact ? "sr-only sm:not-sr-only" : undefined}>MF Screener</span>
    </Link>
  );
}

const MENU_ICON = "M4 7h16M4 12h16M4 17h16";
const CLOSE_ICON = "M6 6l12 12M18 6 6 18";

/**
 * The portfolio's floating glass pill. Seven tools and a search box do not fit in its 64rem
 * in any language, so the links live in a menu below it at every width.
 */
export function SiteHeader() {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLElement>(null);
  const id = useId();

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    return () => document.removeEventListener("pointerdown", onPointer);
  }, [open]);

  return (
    <header
      ref={ref}
      className="fixed inset-x-0 top-4 z-50 px-4 print:static"
      onKeyDown={(event) => {
        if (event.key === "Escape" && open) {
          setOpen(false);
          ref.current?.querySelector<HTMLElement>(`[aria-controls="${id}"]`)?.focus();
        }
      }}
    >
      <div className="glass mx-auto flex max-w-5xl items-center gap-1.5 rounded-full py-2 pr-2 pl-4 sm:gap-2 sm:pl-5">
        <Logo compact />
        <div className="ml-auto flex min-w-0 flex-1 justify-end sm:ml-4">
          <SchemeSearch />
        </div>
        <LanguageSwitcher />
        <ThemeToggle />
        <button
          type="button"
          aria-expanded={open}
          aria-controls={id}
          aria-label={t.nav.menu}
          title={t.nav.menu}
          onClick={() => setOpen((v) => !v)}
          className="btn-icon"
        >
          <svg
            viewBox="0 0 24 24"
            width="20"
            height="20"
            aria-hidden="true"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          >
            <path d={open ? CLOSE_ICON : MENU_ICON} />
          </svg>
        </button>
      </div>
      {open ? <SiteNav id={id} onNavigate={() => setOpen(false)} /> : null}
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
    <footer className="mt-24 border-t border-ink-900/10 print:hidden">
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
      <div className="border-t border-ink-900/10">
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
