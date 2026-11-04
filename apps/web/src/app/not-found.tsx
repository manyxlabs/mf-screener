import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Page not found", robots: { index: false } };

const LINKS = [
  ["Home", "/"],
  ["Screener", "/screener/"],
  ["Fund categories", "/category/"],
  ["Compare funds", "/compare/"],
] as const;

export default function NotFound() {
  return (
    <div className="mx-auto max-w-xl space-y-4 py-16 text-center">
      <p className="text-sm font-medium text-accent-600 numeric">404</p>
      <h1 className="text-2xl font-semibold tracking-tight text-ink-900">
        This page does not exist
      </h1>
      <p className="text-sm text-pretty text-ink-700">
        The address may be mistyped, or the fund may no longer be published: only active schemes
        have a page. Search for a fund above, or start from one of these.
      </p>
      <ul className="flex flex-wrap justify-center gap-2 text-sm">
        {LINKS.map(([label, href]) => (
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
