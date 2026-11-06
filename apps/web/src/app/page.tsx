import Link from "next/link";
import { JsonLd } from "@/components/json-ld";
import { SchemeSearch } from "@/components/scheme-search";
import { getCategories, getMetadata, getPresets } from "@/lib/api";
import { categoryPages, categoryPath } from "@/lib/categories";
import { pageMetadata, SITE_NAME, SITE_URL } from "@/lib/site";
import { loadScreenIndex } from "@/lib/static-data.server";

const DESCRIPTION =
  "Free research tool for Indian mutual funds: rolling returns, peer comparison, risk metrics, fund comparison, a capital gains calculator and CAS portfolio analysis. Not investment advice.";

export const metadata = pageMetadata(
  "/",
  { absolute: "Indian Mutual Fund Screener: rolling returns, peers and risk" },
  DESCRIPTION,
);

const QUICK_LINKS = [
  { label: "Large Cap", sub: "Large Cap Fund" },
  { label: "Flexi Cap", sub: "Flexi Cap Fund" },
  { label: "Mid Cap", sub: "Mid Cap Fund" },
  { label: "Small Cap", sub: "Small Cap Fund" },
  { label: "Multi Cap", sub: "Multi Cap Fund" },
  { label: "Value", sub: "Value Fund" },
  { label: "Index Funds", sub: "Index Funds" },
];

const TOOLS = [
  {
    href: "/compare",
    title: "Compare funds",
    body: "Up to five funds side by side, with the best and worst value in every row marked.",
    cta: "Compare",
    icon: "M4 5h6v14H4zM14 5h6v14h-6z",
  },
  {
    href: "/basket",
    title: "Test a basket",
    body: "Give a few funds a weight each and see how they move together and what blending them does to risk and return.",
    cta: "Build a basket",
    icon: "M3 9h18l-2 11H5zM8 9V7a4 4 0 0 1 8 0v2",
  },
  {
    href: "/glossary",
    title: "Learn the terms",
    body: "Every number on this site explained in plain words: what it measures, which way is better and where it misleads.",
    cta: "Open the glossary",
    icon: "M4 5a2 2 0 0 1 2-2h13v15H6a2 2 0 0 0-2 2zM4 20a2 2 0 0 0 2 2h13v-4",
  },
];

// Keyed by preset id; a preset added later still renders, with the search icon.
const PRESET_ICONS: Record<string, string> = {
  "long-term-consistency": "M3 17l6-6 4 4 8-8M15 7h6v6",
  "mid-multi-momentum": "M13 2 4 14h7l-1 8 9-12h-7z",
  "small-cap-quality": "M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z",
  "value-mandates": "M6 3h12l3 6-9 12L3 9zM3 9h18",
  "sp500-comparison":
    "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18",
};
const SEARCH_ICON = "M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-3.5-3.5";
const TINTS = [
  "bg-gradient-to-br from-sky-500 to-blue-600",
  "bg-gradient-to-br from-amber-400 to-orange-600",
  "bg-gradient-to-br from-emerald-400 to-teal-600",
  "bg-gradient-to-br from-rose-400 to-pink-600",
  "bg-gradient-to-br from-violet-400 to-indigo-600",
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

const chip =
  "rounded-full border border-ink-200 bg-surface/70 px-3 py-1 text-sm text-ink-700 shadow-sm transition-colors hover:border-accent-500 hover:text-accent-600";
const tile =
  "group flex h-full flex-col rounded-xl border border-ink-200 bg-surface p-5 shadow-card transition-[border-color,translate] hover:-translate-y-0.5 hover:border-accent-500";
const heading = "text-xl font-semibold tracking-tight text-ink-900";

function Icon({ d }: { d: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="20"
      height="20"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={d} />
    </svg>
  );
}

function Arrow() {
  return (
    <span
      aria-hidden="true"
      className="inline-block transition-transform group-hover:translate-x-0.5"
    >
      →
    </span>
  );
}

export default async function StartPage() {
  const [metadata, presets, categories, screen, pages] = await Promise.all([
    getMetadata(),
    getPresets(),
    getCategories(),
    loadScreenIndex(),
    categoryPages(),
  ]);
  const available = new Set(
    categories.items.map((item) => item.clean_sub_category ?? "").filter(Boolean),
  );
  const { coverage } = metadata;

  return (
    <div className="space-y-16">
      <JsonLd
        data={{
          "@graph": [
            {
              "@type": "WebSite",
              url: `${SITE_URL}/`,
              name: SITE_NAME,
              alternateName: "Indian Mutual Fund Screener",
              inLanguage: "en-IN",
              publisher: {
                "@type": "Organization",
                name: "Manyx Labs",
                url: "https://www.manyxlabs.com/",
              },
              // The screener's search box reads ?search= from the URL.
              potentialAction: {
                "@type": "SearchAction",
                target: {
                  "@type": "EntryPoint",
                  urlTemplate: `${SITE_URL}/screener/?search={search_term_string}`,
                },
                "query-input": "required name=search_term_string",
              },
            },
            {
              "@type": "WebApplication",
              name: SITE_NAME,
              url: `${SITE_URL}/`,
              description: DESCRIPTION,
              applicationCategory: "FinanceApplication",
              operatingSystem: "Any",
              browserRequirements: "Requires JavaScript",
              isAccessibleForFree: true,
              offers: { "@type": "Offer", price: "0", priceCurrency: "INR" },
            },
          ],
        }}
      />
      <section className="mx-auto max-w-3xl space-y-6 pt-4 text-center sm:pt-10">
        <p className="inline-flex flex-wrap justify-center gap-x-2 rounded-full border border-ink-200 bg-surface/70 px-3 py-1 text-xs text-ink-500 shadow-sm">
          <span className="font-medium text-ink-700">
            {screen.count.toLocaleString("en-IN")} active funds
          </span>
          <span aria-hidden="true">·</span>
          <span>NAV to {coverage.latest_nav_date ?? "-"}</span>
          <span aria-hidden="true">·</span>
          <span>Rebuilt daily</span>
        </p>
        <h1 className="text-3xl font-semibold tracking-tight text-balance text-ink-900 sm:text-5xl">
          Which Indian mutual funds have actually done what they claim?
        </h1>
        <p className="mx-auto max-w-2xl text-base text-pretty text-ink-500 sm:text-lg">
          Every figure is computed here from AMFI&rsquo;s published NAV history, against funds of
          the same kind, and every blank says why. It is a research tool: it will not tell you what
          to buy.
        </p>
        <div className="mx-auto max-w-xl">
          <SchemeSearch size="large" />
        </div>
        <div className="flex flex-wrap justify-center gap-2">
          {QUICK_LINKS.filter((link) => available.has(link.sub)).map((link) => {
            const page = pages.find((p) => p.subCategory === link.sub);
            return (
              <Link
                key={link.sub}
                href={
                  page
                    ? categoryPath(page)
                    : `/screener?sub_category=${encodeURIComponent(link.sub)}`
                }
                className={chip}
              >
                {link.label}
              </Link>
            );
          })}
          <Link href="/screener?search=s%26p+500" className={chip}>
            S&amp;P 500 / overseas
          </Link>
          <Link href="/category/" className={chip}>
            All categories
          </Link>
        </div>
      </section>

      <section className="space-y-5">
        <div>
          <h2 className={heading}>Start from a question</h2>
          <p className="mt-1 text-sm text-ink-500">
            Editable starting points, not shortlists. Each opens in the screener with its filters
            showing, so you can change them.
          </p>
        </div>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {presets.map((preset, index) => (
            <Link key={preset.id} href={`/screener?preset=${preset.id}`} className={tile}>
              <span className="flex items-center gap-3">
                <span
                  className={`grid size-10 shrink-0 place-items-center rounded-xl text-white shadow-sm ${TINTS[index % TINTS.length]}`}
                >
                  <Icon d={PRESET_ICONS[preset.id] ?? SEARCH_ICON} />
                </span>
                <span className="text-xs leading-snug text-ink-500">{preset.subtitle}</span>
              </span>
              <span className="mt-4 text-base font-semibold tracking-tight text-ink-900">
                {preset.question}
              </span>
              <span className="mt-2 line-clamp-3 text-sm leading-relaxed text-ink-700">
                {preset.plain_description}
              </span>
              {/* The screener shows the caution in full above the results; here it only has to be noticed. */}
              <span className="mt-3 line-clamp-2 border-l-2 border-warn-300 pl-3 text-xs leading-relaxed text-ink-500">
                {preset.caution}
              </span>
              <span className="mt-auto pt-5 text-sm font-medium text-accent-600">
                Open this screen <Arrow />
              </span>
            </Link>
          ))}
          <Link
            href="/screener"
            className="group flex h-full flex-col rounded-xl bg-gradient-to-br from-accent-500 to-accent-600 p-5 text-on-accent shadow-card transition-[translate] hover:-translate-y-0.5"
          >
            <span className="grid size-10 place-items-center rounded-xl bg-white/20">
              <Icon d="M3 5h18l-7 8v6l-4 2v-8z" />
            </span>
            <span className="mt-4 text-base font-semibold tracking-tight">
              Or build your own screen
            </span>
            <span className="mt-2 text-sm leading-relaxed opacity-90">
              Filter every active fund on returns, consistency, worst falls, cost and peer standing,
              then save the screen or export it as CSV.
            </span>
            <span className="mt-auto pt-5 text-sm font-semibold">
              Open the screener <Arrow />
            </span>
          </Link>
        </div>
      </section>

      <section className="space-y-5">
        <h2 className={heading}>Already have funds in mind?</h2>
        <div className="grid gap-4 md:grid-cols-3">
          {TOOLS.map((tool) => (
            <Link key={tool.href} href={tool.href} className={tile}>
              <span className="grid size-10 place-items-center rounded-xl bg-accent-500/10 text-accent-600">
                <Icon d={tool.icon} />
              </span>
              <span className="mt-4 text-base font-semibold tracking-tight text-ink-900">
                {tool.title}
              </span>
              <span className="mt-2 text-sm leading-relaxed text-ink-700">{tool.body}</span>
              <span className="mt-auto pt-5 text-sm font-medium text-accent-600">
                {tool.cta} <Arrow />
              </span>
            </Link>
          ))}
        </div>
      </section>

      <section className="space-y-5">
        <h2 className={heading}>Three things to know before you read any number</h2>
        <ol className="grid overflow-hidden rounded-2xl border border-ink-200 bg-surface shadow-card md:grid-cols-3">
          {READ_FIRST.map((item, index) => (
            <li
              key={item.href}
              className="border-ink-200 not-first:border-t md:not-first:border-t-0 md:not-first:border-l"
            >
              <Link href={item.href} className="group block h-full p-6 hover:bg-ink-900/[0.03]">
                <span className="text-sm font-semibold text-accent-600 numeric">0{index + 1}</span>
                <span className="mt-2 block text-base font-semibold tracking-tight text-ink-900">
                  {item.heading}
                </span>
                <span className="mt-2 block text-sm leading-relaxed text-ink-700">{item.body}</span>
                <span className="mt-4 block text-sm font-medium text-accent-600">
                  Read more <Arrow />
                </span>
              </Link>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
