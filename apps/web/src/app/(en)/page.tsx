import Link from "@/components/link";
import { JsonLd } from "@/components/json-ld";
import { SchemeSearch } from "@/components/scheme-search";
import { getCategories, getMetadata, getPresets } from "@/lib/api";
import { categoryPages, categoryPath } from "@/lib/categories";
import { routeI18n, type LocaleParams } from "@/lib/i18n/server";
import { pageMetadata, SITE_NAME, SITE_URL } from "@/lib/site";
import { loadScreenIndex } from "@/lib/static-data.server";

export async function generateMetadata({ params }: LocaleParams) {
  const i18n = await routeI18n(params);
  return pageMetadata(i18n, "/", { absolute: i18n.t.home.metaTitle }, i18n.t.home.metaDescription);
}

const TOOLS = [
  { id: "compare", href: "/compare", icon: "M4 5h6v14H4zM14 5h6v14h-6z" },
  { id: "basket", href: "/basket", icon: "M3 9h18l-2 11H5zM8 9V7a4 4 0 0 1 8 0v2" },
  {
    id: "glossary",
    href: "/glossary",
    icon: "M4 5a2 2 0 0 1 2-2h13v15H6a2 2 0 0 0-2 2zM4 20a2 2 0 0 0 2 2h13v-4",
  },
] as const;

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
  { id: "pastReturn", href: "/glossary#past-return" },
  { id: "peerGroup", href: "/glossary#peer-group" },
  { id: "blankValues", href: "/glossary#blank-values" },
] as const;

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

export default async function StartPage({ params }: LocaleParams) {
  const [{ t, td, number, href, locale }, metadata, presets, categories, screen, pages] =
    await Promise.all([
      routeI18n(params),
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
              url: `${SITE_URL}${href("/")}`,
              name: SITE_NAME,
              alternateName: t.meta.title,
              inLanguage: `${locale}-IN`,
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
                  urlTemplate: `${SITE_URL}${href("/screener/")}?search={search_term_string}`,
                },
                "query-input": "required name=search_term_string",
              },
            },
            {
              "@type": "WebApplication",
              name: SITE_NAME,
              url: `${SITE_URL}${href("/")}`,
              description: t.home.metaDescription,
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
            {t.home.activeFunds(number(screen.count))}
          </span>
          <span aria-hidden="true">·</span>
          <span>{t.home.navTo(coverage.latest_nav_date ?? "-")}</span>
          <span aria-hidden="true">·</span>
          <span>{t.home.rebuiltDaily}</span>
        </p>
        <h1 className="text-3xl font-semibold tracking-tight text-balance text-ink-900 sm:text-5xl">
          {t.home.title}
        </h1>
        <p className="mx-auto max-w-2xl text-base text-pretty text-ink-500 sm:text-lg">
          {t.home.lede}
        </p>
        <div className="mx-auto max-w-xl">
          <SchemeSearch size="large" />
        </div>
        <div className="flex flex-wrap justify-center gap-2">
          {Object.entries(t.home.quickLinks)
            .filter(([sub]) => available.has(sub))
            .map(([sub, label]) => {
              const page = pages.find((p) => p.subCategory === sub);
              return (
                <Link
                  key={sub}
                  href={
                    page ? categoryPath(page) : `/screener?sub_category=${encodeURIComponent(sub)}`
                  }
                  className={chip}
                >
                  {label}
                </Link>
              );
            })}
          <Link href="/screener?search=s%26p+500" className={chip}>
            {t.home.overseas}
          </Link>
          <Link href="/category/" className={chip}>
            {t.home.allCategories}
          </Link>
        </div>
      </section>

      <section className="space-y-5">
        <div>
          <h2 className={heading}>{t.home.presetsHeading}</h2>
          <p className="mt-1 text-sm text-ink-500">{t.home.presetsLede}</p>
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
                <span className="text-xs leading-snug text-ink-500">{td(preset.subtitle)}</span>
              </span>
              <span className="mt-4 text-base font-semibold tracking-tight text-ink-900">
                {td(preset.question)}
              </span>
              <span className="mt-2 line-clamp-3 text-sm leading-relaxed text-ink-700">
                {td(preset.plain_description)}
              </span>
              {/* The screener shows the caution in full above the results; here it only has to be noticed. */}
              <span className="mt-3 line-clamp-2 border-l-2 border-warn-300 pl-3 text-xs leading-relaxed text-ink-500">
                {td(preset.caution)}
              </span>
              <span className="mt-auto pt-5 text-sm font-medium text-accent-600">
                {t.home.openPreset} <Arrow />
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
              {t.home.ownScreen.title}
            </span>
            <span className="mt-2 text-sm leading-relaxed opacity-90">{t.home.ownScreen.body}</span>
            <span className="mt-auto pt-5 text-sm font-semibold">
              {t.home.ownScreen.cta} <Arrow />
            </span>
          </Link>
        </div>
      </section>

      <section className="space-y-5">
        <h2 className={heading}>{t.home.toolsHeading}</h2>
        <div className="grid gap-4 md:grid-cols-3">
          {TOOLS.map((tool) => (
            <Link key={tool.href} href={tool.href} className={tile}>
              <span className="grid size-10 place-items-center rounded-xl bg-accent-500/10 text-accent-600">
                <Icon d={tool.icon} />
              </span>
              <span className="mt-4 text-base font-semibold tracking-tight text-ink-900">
                {t.home.tools[tool.id].title}
              </span>
              <span className="mt-2 text-sm leading-relaxed text-ink-700">
                {t.home.tools[tool.id].body}
              </span>
              <span className="mt-auto pt-5 text-sm font-medium text-accent-600">
                {t.home.tools[tool.id].cta} <Arrow />
              </span>
            </Link>
          ))}
        </div>
      </section>

      <section className="space-y-5">
        <h2 className={heading}>{t.home.readFirstHeading}</h2>
        <ol className="grid overflow-hidden rounded-2xl border border-ink-200 bg-surface shadow-card md:grid-cols-3">
          {READ_FIRST.map((item, index) => (
            <li
              key={item.href}
              className="border-ink-200 not-first:border-t md:not-first:border-t-0 md:not-first:border-l"
            >
              <Link href={item.href} className="group block h-full p-6 hover:bg-ink-900/[0.03]">
                <span className="text-sm font-semibold text-accent-600 numeric">0{index + 1}</span>
                <span className="mt-2 block text-base font-semibold tracking-tight text-ink-900">
                  {t.home.readFirst[item.id].heading}
                </span>
                <span className="mt-2 block text-sm leading-relaxed text-ink-700">
                  {t.home.readFirst[item.id].body}
                </span>
                <span className="mt-4 block text-sm font-medium text-accent-600">
                  {t.home.readMore} <Arrow />
                </span>
              </Link>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
