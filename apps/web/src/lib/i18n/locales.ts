import type { Messages } from "@/messages/en";

/**
 * Every language the site ships, each named in its own script for the switcher. A new
 * language is its catalogue in src/messages plus one entry here.
 */
export const LANGUAGES = {
  en: { name: "English", load: () => import("@/messages/en") },
  hi: { name: "हिन्दी", load: () => import("@/messages/hi") },
  bn: { name: "বাংলা", load: () => import("@/messages/bn") },
  mr: { name: "मराठी", load: () => import("@/messages/mr") },
  te: { name: "తెలుగు", load: () => import("@/messages/te") },
  ta: { name: "தமிழ்", load: () => import("@/messages/ta") },
  gu: { name: "ગુજરાતી", load: () => import("@/messages/gu") },
  kn: { name: "ಕನ್ನಡ", load: () => import("@/messages/kn") },
  ml: { name: "മലയാളം", load: () => import("@/messages/ml") },
} satisfies Record<string, { name: string; load: () => Promise<{ default: Messages }> }>;

export type Locale = keyof typeof LANGUAGES;

export const DEFAULT_LOCALE: Locale = "en";

export const LOCALES = Object.keys(LANGUAGES) as Locale[];

/** The languages served under a /<code>/ prefix; English keeps the unprefixed URLs. */
export const PREFIXED_LOCALES = LOCALES.filter((locale) => locale !== DEFAULT_LOCALE);

export const isLocale = (value: unknown): value is Locale =>
  typeof value === "string" && Object.hasOwn(LANGUAGES, value);

/** Indian regional formats, but Western digits even where a script has its own. */
export const intlLocale = (locale: Locale) => `${locale}-IN-u-nu-latn`;

/**
 * Fund pages exist at their English URL only, translated in the browser: one copy per
 * language of ~8,700 pages would push the site past GitHub Pages' 1 GB limit.
 */
export const SINGLE_URL_PREFIX = "/fund/";

export const isSingleUrlPath = (path: string) => path.startsWith(SINGLE_URL_PREFIX);

/** `path` as served in `locale`; it must start with "/". */
export function localePath(locale: Locale, path: string): string {
  if (locale === DEFAULT_LOCALE || isSingleUrlPath(path)) return path;
  return `/${locale}${path}`;
}

/** Splits a pathname into its language and the English path it mirrors. */
export function splitLocale(pathname: string): { locale: Locale; path: string } {
  const [, first, ...rest] = pathname.split("/");
  if (first && first !== DEFAULT_LOCALE && isLocale(first)) {
    return { locale: first, path: `/${rest.join("/")}` };
  }
  return { locale: DEFAULT_LOCALE, path: pathname };
}
