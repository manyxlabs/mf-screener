"use client";

import { DEFAULT_FILTERS, type ScreenFilters } from "./screen-query";

const KEY = "mf-screener.saved-screens.v1";

export type SavedScreen = { name: string; savedAt: string; filters: ScreenFilters };

/** Saved screens live in this browser only; nothing is sent anywhere. */
export function loadSavedScreens(): SavedScreen[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // A screen saved before a filter existed has no key for it. Defaults fill the gap,
    // so an old screen stays loadable instead of serialising an undefined list. An empty
    // plan or option list, which the drawer once allowed, is what the API reads as the
    // default anyway, so it comes back as that rather than as boxes all unticked.
    return (parsed as SavedScreen[]).map(({ filters, ...screen }) => ({
      ...screen,
      filters: {
        ...DEFAULT_FILTERS,
        ...filters,
        plans: filters.plans?.length ? filters.plans : DEFAULT_FILTERS.plans,
        options: filters.options?.length ? filters.options : DEFAULT_FILTERS.options,
      },
    }));
  } catch {
    return [];
  }
}

export function saveScreen(name: string, filters: ScreenFilters): SavedScreen[] {
  const next = [
    ...loadSavedScreens().filter((s) => s.name !== name),
    { name, savedAt: new Date().toISOString(), filters },
  ];
  window.localStorage.setItem(KEY, JSON.stringify(next));
  return next;
}

export function deleteScreen(name: string): SavedScreen[] {
  const next = loadSavedScreens().filter((s) => s.name !== name);
  window.localStorage.setItem(KEY, JSON.stringify(next));
  return next;
}
