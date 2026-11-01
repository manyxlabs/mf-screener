import type { Metadata } from "next";
import Link from "next/link";
import { SchemeSearch } from "@/components/scheme-search";
import { THEME_INIT_SCRIPT, ThemeToggle } from "@/components/theme-toggle";
import "./globals.css";

export const metadata: Metadata = {
  title: "Indian Mutual Fund Screener",
  description:
    "Local-first screener for Indian mutual funds: trailing and rolling returns, peer-relative and risk-adjusted metrics. Research only, not investment advice.",
};

// "Shortlist" rather than "Picks", because /picks is a workspace you fill in and
// "picks" reads as though the site made them. /benchmarks moves to the footer: it is
// a data-coverage page for whoever maintains the store, not a research entry point.
const NAV = [
  { href: "/", label: "Start" },
  { href: "/screener", label: "Screener" },
  { href: "/compare", label: "Compare" },
  { href: "/basket", label: "Basket" },
  { href: "/overlap", label: "Overlap" },
  { href: "/picks", label: "Shortlist" },
  { href: "/glossary", label: "Glossary" },
  { href: "/methodology", label: "Methodology" },
];

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-screen font-sans antialiased">
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
        <header className="border-b border-ink-200 bg-surface">
          <div className="mx-auto flex max-w-[1600px] flex-wrap items-center gap-x-8 gap-y-2 px-4 py-3 sm:px-6">
            <Link href="/" className="shrink-0 text-sm font-semibold tracking-tight">
              MF Screener
              <span className="ml-2 rounded bg-ink-100 px-1.5 py-0.5 text-[10px] font-medium text-ink-500">
                local
              </span>
            </Link>
            {/* Below xl the links get their own scrolling row rather than pushing the page wide. */}
            <nav className="-mx-3 order-last flex w-[calc(100%+1.5rem)] gap-1 overflow-x-auto text-sm xl:order-none xl:mx-0 xl:w-auto">
              {NAV.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="shrink-0 whitespace-nowrap rounded px-3 py-1.5 text-ink-700 hover:bg-ink-100"
                >
                  {item.label}
                </Link>
              ))}
            </nav>
            <div className="ml-auto flex min-w-0 flex-1 items-center justify-end gap-3 xl:flex-none">
              <SchemeSearch />
              <ThemeToggle />
            </div>
          </div>
        </header>
        <main className="mx-auto max-w-[1600px] px-4 py-6 sm:px-6">{children}</main>
        <footer className="mx-auto max-w-[1600px] space-y-2 px-4 pb-10 sm:px-6 pt-4 text-xs text-ink-500">
          <p>
            Research and analytics only. Not investment advice. Historical returns do not guarantee
            future returns.
          </p>
          <p>
            <Link className="underline hover:text-ink-700" href="/benchmarks">
              Benchmark coverage
            </Link>
            {" · "}
            <Link className="underline hover:text-ink-700" href="/data-status">
              Data status
            </Link>
          </p>
          <p>
            NAV data originates from AMFI public records, delivered through the TigZig MF NAV API.
            This project is not affiliated with or endorsed by AMFI. Verify anything that matters
            against AMFI directly.
          </p>
        </footer>
      </body>
    </html>
  );
}
