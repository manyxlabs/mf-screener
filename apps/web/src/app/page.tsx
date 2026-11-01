import Link from "next/link";
import { SchemeSearch } from "@/components/scheme-search";
import { Card } from "@/components/ui";
import { getCategories, getMetadata, getPresets } from "@/lib/api";

const QUICK_LINKS = [
  { label: "Mid Cap", sub: "Mid Cap Fund" },
  { label: "Small Cap", sub: "Small Cap Fund" },
  { label: "Flexi Cap", sub: "Flexi Cap Fund" },
  { label: "Large Cap", sub: "Large Cap Fund" },
  { label: "Value", sub: "Value Fund" },
  { label: "Multi Cap", sub: "Multi Cap Fund" },
  { label: "Index Funds", sub: "Index Funds" },
];

/**
 * The three things that most change how a beginner reads every other page, each one
 * the accessible face of a rule the rest of the site already enforces.
 */
const READ_FIRST = [
  {
    heading: "Every number here is the past",
    body: "Returns describe what already happened, under market conditions that will not repeat to order. Nothing on this site is a forecast, a rating or a recommendation.",
    href: "/glossary#past-return",
  },
  {
    heading: "Funds are compared with their own kind",
    body: "A small-cap fund is measured against small-cap funds, never against the whole market. Funds that closed are missing from that average, which flatters it.",
    href: "/glossary#peer-group",
  },
  {
    heading: "A dash is an answer, not a gap",
    body: "Where a number could not be computed honestly it is left blank, and clicking the blank says exactly why. Nothing is filled in with an average.",
    href: "/glossary#blank-values",
  },
];

export default async function StartPage() {
  const [metadata, presets, categories] = await Promise.all([
    getMetadata(),
    getPresets(),
    getCategories(),
  ]);
  const available = new Set(
    categories.items.map((item) => item.clean_sub_category ?? "").filter(Boolean),
  );

  return (
    <div className="space-y-8">
      <section className="mx-auto max-w-3xl space-y-4 pt-4 text-center">
        <h1 className="text-2xl font-semibold tracking-tight text-ink-900">
          Which Indian mutual funds have actually done what they claim?
        </h1>
        <p className="text-sm text-ink-500">
          Every figure is computed here, from AMFI&rsquo;s published NAV history, with the peer
          group named and the reason stated wherever a number is missing. It is a research tool: it
          will not tell you what to buy.
        </p>
        <div className="mx-auto flex max-w-xl flex-col items-stretch gap-1">
          <SchemeSearch size="large" />
          <p className="text-xs text-ink-500">
            Look up a fund you already own, or one you have been pitched.
          </p>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-ink-900">Or start from a question</h2>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {presets.map((preset) => (
            <Link
              key={preset.id}
              href={`/screener?preset=${preset.id}`}
              className="flex flex-col rounded-lg border border-ink-200 bg-surface p-4 transition-colors hover:border-accent-500"
            >
              <span className="text-sm font-semibold text-ink-900">{preset.question}</span>
              <span className="mt-1.5 text-xs leading-relaxed text-ink-700">
                {preset.plain_description}
              </span>
              <span className="mt-2 border-t border-ink-100 pt-2 text-[11px] leading-relaxed text-ink-500">
                {preset.caution}
              </span>
            </Link>
          ))}
        </div>
        <p className="text-xs text-ink-500">
          These are editable starting points, not shortlists. Every one of them opens in the
          screener with its filters showing, so you can change them.
        </p>
      </section>

      <Card title="Start with a category">
        <div className="flex flex-wrap gap-2">
          {QUICK_LINKS.filter((link) => available.has(link.sub)).map((link) => (
            <Link
              key={link.sub}
              href={`/screener?sub_category=${encodeURIComponent(link.sub)}`}
              className="rounded-md border border-ink-300 px-3 py-1.5 text-sm hover:bg-ink-100"
            >
              {link.label}
            </Link>
          ))}
          <Link
            href="/screener?search=s%26p+500"
            className="rounded-md border border-ink-300 px-3 py-1.5 text-sm hover:bg-ink-100"
          >
            S&amp;P 500 / overseas
          </Link>
        </div>
        {QUICK_LINKS.some((link) => !available.has(link.sub)) ? (
          <p className="mt-3 text-xs text-ink-500">
            Sub-categories missing from this list are not present in the loaded dataset. The sample
            dataset covers only a handful of them; run <code>make data-build</code> for the full
            universe.
          </p>
        ) : null}
      </Card>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-ink-900">
          Three things to know before you read any number
        </h2>
        <div className="grid gap-3 md:grid-cols-3">
          {READ_FIRST.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="rounded-lg border border-ink-200 bg-surface p-4 transition-colors hover:border-accent-500"
            >
              <span className="block text-sm font-semibold text-ink-900">{item.heading}</span>
              <span className="mt-1 block text-xs leading-relaxed text-ink-700">{item.body}</span>
            </Link>
          ))}
        </div>
      </section>

      <p className="border-t border-ink-100 pt-4 text-xs text-ink-500">
        Metrics as of {metadata.coverage.metrics_as_of ?? "-"} · NAV to{" "}
        {metadata.coverage.last_nav_date ?? "-"} · methodology v{metadata.methodology_version} ·{" "}
        <Link className="underline hover:text-ink-700" href="/data-status">
          data status
        </Link>
      </p>
    </div>
  );
}
