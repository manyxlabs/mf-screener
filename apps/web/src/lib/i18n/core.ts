import type { Messages } from "@/messages/en";
import { dataKey, NUMBER } from "./data-key";
import { intlLocale, localePath, type Locale } from "./locales";

const SLOT = /\{(\d+)\}/g;

export type I18n = {
  locale: Locale;
  t: Messages;
  /**
   * Text the data pipeline wrote (metric definitions, missing-value reasons, the
   * methodology document), in this language where the catalogue has it and as published
   * otherwise. Names from AMFI never go through it.
   */
  td: (text: string) => string;
  /** An internal path as served in this language. */
  href: (path: string) => string;
  number: (value: number, options?: Intl.NumberFormatOptions) => string;
};

export function makeI18n(locale: Locale, t: Messages): I18n {
  const format = new Intl.NumberFormat(intlLocale(locale));
  return {
    locale,
    t,
    td: (text) => {
      const translated = t.data[dataKey(text)];
      if (translated === undefined) return text;
      const numbers = text.match(NUMBER) ?? [];
      return translated.replace(SLOT, (slot, index: string) => numbers[Number(index)] ?? slot);
    },
    href: (path) => localePath(locale, path),
    number: (value, options) =>
      options ? value.toLocaleString(intlLocale(locale), options) : format.format(value),
  };
}
