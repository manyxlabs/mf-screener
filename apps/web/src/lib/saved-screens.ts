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
    // so an old screen stays loadable instead of serialising an undefined list.
    return (parsed as SavedScreen[]).map((screen) => ({
      ...screen,
      filters: { ...DEFAULT_FILTERS, ...screen.filters },
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
