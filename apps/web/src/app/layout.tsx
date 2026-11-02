import type { Metadata } from "next";
import Link from "next/link";
import { SchemeSearch } from "@/components/scheme-search";
import { SiteNav } from "@/components/site-nav";
import { THEME_INIT_SCRIPT, ThemeToggle } from "@/components/theme-toggle";
import { getMetadata } from "@/lib/api";
import { SITE_URL } from "@/lib/site";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: "Indian Mutual Fund Screener",
  description:
    "Screener for Indian mutual funds: trailing and rolling returns, peer-relative and risk-adjusted metrics. Research only, not investment advice.",
};

const FOOTER_LINKS = [
  [
    "Tools",
    [
      ["Screener", "/screener"],
      ["Compare funds", "/compare"],
      ["Basket analysis", "/basket"],
      ["Portfolio checkup", "/portfolio"],
      ["Capital gains tax", "/capital-gains"],
      ["Portfolio overlap", "/overlap"],
    ],
  ],
  [
    "Learn",
    [
      ["Glossary", "/glossary"],
      ["Methodology", "/methodology"],
      ["Benchmark coverage", "/benchmarks"],
      ["Data status", "/data-status"],
    ],
  ],
  [
    "Project",
    [
      ["Source on GitHub", "https://github.com/manyxlabs/mf-screener"],
      ["Report an issue", "https://github.com/manyxlabs/mf-screener/issues/new"],
      ["How to contribute", "https://github.com/manyxlabs/mf-screener/blob/main/CONTRIBUTING.md"],
      ["Manyx Labs", "https://www.manyxlabs.com/"],
    ],
  ],
] as const;

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const { coverage } = await getMetadata();
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-screen font-sans antialiased">
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
        <header className="sticky top-0 z-40 px-3 pt-3 sm:px-4 print:static">
          <div className="glass mx-auto flex max-w-[1600px] flex-wrap items-center gap-x-6 gap-y-2 rounded-2xl px-3 py-2 sm:px-4">
            <Link
              href="/"
              className="flex shrink-0 items-center gap-2 font-semibold tracking-tight"
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- a 24px static SVG gains nothing from next/image */}
              <img src="/icon.svg" alt="" width={24} height={24} className="rounded-md" />
              MF Screener
            </Link>
            <SiteNav />
            <div className="ml-auto flex min-w-0 flex-1 items-center justify-end gap-2 lg:flex-none">
              <SchemeSearch />
              <ThemeToggle />
            </div>
          </div>
        </header>
        <main className="mx-auto max-w-[1600px] px-4 py-8 sm:px-6">{children}</main>
        <footer className="mt-16 border-t border-ink-200 bg-surface/40 print:hidden">
          <div className="mx-auto grid max-w-[1600px] gap-10 px-4 py-12 sm:px-6 md:grid-cols-[1.4fr_repeat(3,1fr)]">
            <div className="space-y-3">
              <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
                {/* eslint-disable-next-line @next/next/no-img-element -- a 24px static SVG gains nothing from next/image */}
                <img src="/icon.svg" alt="" width={24} height={24} className="rounded-md" />
                MF Screener
              </Link>
              <p className="max-w-sm text-sm text-ink-500">
                Every Indian mutual fund, measured from its own NAV history against funds of the
                same kind. Free, open source and rebuilt every night.
              </p>
            </div>
            {FOOTER_LINKS.map(([title, links]) => (
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
              <p className="font-medium text-ink-700">
                Research and analytics only. Not investment advice. Past returns do not guarantee
                future returns.
              </p>
              <p>
                {`Latest NAV ${coverage.latest_nav_date ?? "-"} · metrics as of ${coverage.metrics_as_of ?? "-"}. `}
                NAV data originates from AMFI public records, delivered through the TigZig MF NAV
                API. Not affiliated with or endorsed by AMFI; verify anything that matters against
                AMFI directly.
              </p>
            </div>
          </div>
        </footer>
      </body>
    </html>
  );
}
