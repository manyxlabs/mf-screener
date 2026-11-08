import en, { type Messages } from "@/messages/en";
import { dataNeedsReview, REVIEW_PATHS } from "@/messages/review";
import { dataKey, NUMBER } from "./data-key";
import { intlLocale, LANGUAGES, localePath, type Locale } from "./locales";

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

type Tree = Record<string, unknown>;

/** `t` with the English value at `path` ("a.b.c"), copying only the objects on the way. */
const withEnglish = (t: Tree, english: Tree, [key, ...rest]: string[]): Tree => ({
  ...t,
  [key!]: rest.length ? withEnglish(t[key!] as Tree, english[key!] as Tree, rest) : english[key!],
});

export function makeI18n(locale: Locale, messages: Messages): I18n {
  const { reviewed } = LANGUAGES[locale];
  const t = reviewed
    ? messages
    : (REVIEW_PATHS.reduce<Tree>(
        (tree, path) => withEnglish(tree, en, path.split(".")),
        messages,
      ) as Messages);
  const format = new Intl.NumberFormat(intlLocale(locale));
  return {
    locale,
    t,
    td: (text) => {
      const translated = reviewed || !dataNeedsReview(text) ? t.data[dataKey(text)] : undefined;
      if (translated === undefined) return text;
      const numbers = text.match(NUMBER) ?? [];
      return translated.replace(SLOT, (slot, index: string) => numbers[Number(index)] ?? slot);
    },
    href: (path) => localePath(locale, path),
    number: (value, options) =>
      options ? value.toLocaleString(intlLocale(locale), options) : format.format(value),
  };
}
