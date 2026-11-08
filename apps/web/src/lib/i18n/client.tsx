"use client";

import { usePathname } from "next/navigation";
import {
  createContext,
  startTransition,
  use,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import en from "@/messages/en";
import { makeI18n, type I18n } from "./core";
import { LOCALE_KEY } from "./locale-script";
import { DEFAULT_LOCALE, isLocale, isSingleUrlPath, LANGUAGES, type Locale } from "./locales";

// English is bundled, so the ~9,000 English-only pages hydrate without waiting on a
// chunk. Every other catalogue is its own chunk, fetched by the pages that need it.
const english = makeI18n(DEFAULT_LOCALE, en);

// React's `use` reads a promise marked fulfilled without suspending, so a catalogue already
// here never suspends a render again. It must be called on every render: calling it only
// for a missing catalogue changes the hooks a replayed render runs (React error 310/467).
const fulfilled = (i18n: I18n): Promise<I18n> =>
  Object.assign(Promise.resolve(i18n), { status: "fulfilled", value: i18n });
const pending = new Map<Locale, Promise<I18n>>([[DEFAULT_LOCALE, fulfilled(english)]]);

export function loadI18n(locale: Locale): Promise<I18n> {
  let hit = pending.get(locale);
  if (!hit) {
    const loading: Promise<I18n> = LANGUAGES[locale].load().then(({ default: messages }) => {
      const i18n = makeI18n(locale, messages);
      Object.assign(loading, { status: "fulfilled", value: i18n });
      return i18n;
    });
    // A failed chunk is not remembered, so the next attempt can succeed.
    loading.catch(() => pending.delete(locale));
    pending.set(locale, (hit = loading));
  }
  return hit;
}

/** The stored choice, else the browser's first language the site has. */
function preferredLocale(): Locale {
  try {
    const stored = localStorage.getItem(LOCALE_KEY);
    if (isLocale(stored)) return stored;
  } catch {
    // storage blocked: fall through to the browser's languages
  }
  for (const tag of navigator.languages) {
    const primary = tag.split("-")[0]?.toLowerCase();
    if (isLocale(primary)) return primary;
  }
  return DEFAULT_LOCALE;
}

export function storeLocale(locale: Locale) {
  try {
    localStorage.setItem(LOCALE_KEY, locale);
  } catch {
    // a browser with storage blocked still gets this page in the language it chose
  }
}

const reveal = () => delete document.documentElement.dataset.localePending;

type Value = { i18n: I18n; switchInPlace: ((locale: Locale) => void) | null };

// English outside a provider, which is where component tests render.
const Context = createContext<Value>({ i18n: english, switchInPlace: null });

/**
 * `locale` is the URL's language. On a single-URL page under the English layout the
 * reader's preference wins instead, applied after hydration.
 */
export function I18nProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  const pathname = usePathname();
  const single = locale === DEFAULT_LOCALE && isSingleUrlPath(pathname);
  const [chosen, setChosen] = useState<Locale>(locale);
  const active = single ? chosen : locale;
  // Suspends only for a catalogue not yet fetched: the server render waits for it, and
  // in the browser hydration keeps the server's HTML until it arrives.
  const i18n = use(loadI18n(active));

  const switchInPlace = useCallback((next: Locale) => {
    storeLocale(next);
    loadI18n(next).then(
      () => startTransition(() => setChosen(next)),
      () => reveal(),
    );
  }, []);

  useEffect(() => {
    if (!single) {
      storeLocale(locale);
      return;
    }
    const preferred = preferredLocale();
    if (preferred === DEFAULT_LOCALE) reveal();
    else
      loadI18n(preferred).then(
        () => startTransition(() => setChosen(preferred)),
        () => reveal(),
      );
  }, [single, locale]);

  useEffect(() => {
    document.documentElement.lang = active;
    if (active !== DEFAULT_LOCALE || !single) reveal();
  }, [active, single]);

  const value = useMemo(
    () => ({ i18n, switchInPlace: single ? switchInPlace : null }),
    [i18n, single, switchInPlace],
  );
  return <Context value={value}>{children}</Context>;
}

export const useI18n = (): I18n => useContext(Context).i18n;

/** Non-null on a single-URL page, where switching language re-renders in place. */
export const useSwitchInPlace = () => useContext(Context).switchInPlace;
