"use client";

import { useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n/client";

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
  const { t } = useI18n();
  const [theme, setTheme] = useState<Theme | null>(null);

  // The server cannot know the stored choice, so the button reads it after mount and
  // renders a fixed-width placeholder until then rather than guessing and shifting.
  useEffect(() => {
    setTheme(document.documentElement.dataset.theme === "dark" ? "dark" : "light");
  }, []);

  return (
    <button
      type="button"
      aria-label={theme === "dark" ? t.theme.toLight : t.theme.toDark}
      aria-pressed={theme === "dark"}
      onClick={() => {
        const next: Theme = theme === "dark" ? "light" : "dark";
        apply(next);
        setTheme(next);
      }}
      className="grid size-9 shrink-0 place-items-center rounded-full border border-ink-200 bg-surface/60 text-ink-500 transition-colors hover:text-ink-900"
    >
      {theme === null ? null : (
        <svg
          viewBox="0 0 24 24"
          width="18"
          height="18"
          aria-hidden="true"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          {theme === "dark" ? (
            <>
              <circle cx="12" cy="12" r="4" />
              <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
            </>
          ) : (
            <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
          )}
        </svg>
      )}
    </button>
  );
}
