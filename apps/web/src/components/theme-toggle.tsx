"use client";

import { useEffect, useState } from "react";

export type Theme = "light" | "dark";

export const THEME_KEY = "mf-theme";

/**
 * Runs before the first paint, from a blocking inline script, so the page never renders
 * light and then flips. It is inlined as a string because a React effect runs too late.
 */
export const THEME_INIT_SCRIPT = `(function(){try{var t=localStorage.getItem(${JSON.stringify(
  THEME_KEY,
)});if(!t)t=matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";document.documentElement.dataset.theme=t}catch(e){}})()`;

function apply(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    // a browser with storage blocked still gets the theme for this page view
  }
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme | null>(null);

  // The server cannot know the stored choice, so the button reads it after mount and
  // renders a fixed-width placeholder until then rather than guessing and shifting.
  useEffect(() => {
    setTheme(document.documentElement.dataset.theme === "dark" ? "dark" : "light");
  }, []);

  return (
    <button
      type="button"
      aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
      aria-pressed={theme === "dark"}
      onClick={() => {
        const next: Theme = theme === "dark" ? "light" : "dark";
        apply(next);
        setTheme(next);
      }}
      className="w-8 rounded border border-ink-300 py-1 text-center text-sm text-ink-700 hover:bg-ink-100"
    >
      {theme === null ? "" : theme === "dark" ? "☀" : "☾"}
    </button>
  );
}
