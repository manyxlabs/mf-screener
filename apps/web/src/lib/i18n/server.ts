import "server-only";
import { notFound } from "next/navigation";
import { cache } from "react";
import { makeI18n } from "./core";
import { DEFAULT_LOCALE, isLocale, LANGUAGES, type Locale } from "./locales";

export const getI18n = cache(async (locale: Locale) =>
  makeI18n(locale, (await LANGUAGES[locale].load()).default),
);

/**
 * Every page renders under both the English tree, which has no `lang` segment, and
 * app/[lang], which re-exports it.
 */
export type LocaleParams = { params: Promise<{ lang?: string }> };

export async function routeLocale(params: LocaleParams["params"]): Promise<Locale> {
  const { lang } = await params;
  if (lang === undefined) return DEFAULT_LOCALE;
  if (!isLocale(lang) || lang === DEFAULT_LOCALE) notFound();
  return lang;
}

export const routeI18n = async (params: LocaleParams["params"]) =>
  getI18n(await routeLocale(params));
