"use client";

import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { useI18n, useSwitchInPlace } from "@/lib/i18n/client";
import { LANGUAGES, localePath, LOCALES, splitLocale } from "@/lib/i18n/locales";

const item =
  "block w-full rounded-xl px-3 py-2 text-left text-sm whitespace-nowrap hover:bg-ink-100";

/**
 * A disclosure of plain links, each to this page in that language; on a single-URL page,
 * buttons that translate it in place. The names render only while it is open: each is in its
 * own script, and drawing them would fetch every script's font.
 */
export function LanguageSwitcher() {
  const { locale, t } = useI18n();
  const switchInPlace = useSwitchInPlace();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const id = useId();

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    return () => document.removeEventListener("pointerdown", onPointer);
  }, [open]);

  const path = splitLocale(pathname).path;
  // Query and hash carry a screen's filters and a glossary entry. The list renders only
  // once opened, in the browser, so `window` is always there to read them from. The
  // page it leads to stores the choice.
  const target = (code: (typeof LOCALES)[number]) =>
    `${localePath(code, path)}${window.location.search}${window.location.hash}`;

  return (
    <div
      ref={ref}
      className="relative shrink-0"
      onKeyDown={(event) => {
        if (event.key === "Escape" && open) {
          setOpen(false);
          ref.current?.querySelector("button")?.focus();
        }
      }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
      }}
    >
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        aria-label={t.language.label}
        title={t.language.label}
        onClick={() => setOpen((v) => !v)}
        className="flex h-10 min-w-10 shrink-0 items-center justify-center gap-1.5 rounded-full text-sm text-ink-900 transition-colors hover:bg-ink-900/10 sm:px-3"
      >
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
          <circle cx="12" cy="12" r="9" />
          <path d="M3 12h18M12 3c2.5 2.7 3.8 5.7 3.8 9s-1.3 6.3-3.8 9c-2.5-2.7-3.8-5.7-3.8-9S9.5 5.7 12 3z" />
        </svg>
        <span className="hidden sm:inline" lang={locale}>
          {LANGUAGES[locale].name}
        </span>
      </button>
      {open ? (
        <ul id={id} className="panel absolute right-0 z-40 mt-3 min-w-40 rounded-2xl p-1.5">
          {LOCALES.map((code) => {
            const current = code === locale;
            const label = (
              <span lang={code} className={current ? "font-medium text-ink-900" : "text-ink-500"}>
                {LANGUAGES[code].name}
              </span>
            );
            return (
              <li key={code}>
                {switchInPlace ? (
                  <button
                    type="button"
                    className={item}
                    aria-current={current ? "true" : undefined}
                    onClick={() => {
                      setOpen(false);
                      switchInPlace(code);
                    }}
                  >
                    {label}
                  </button>
                ) : (
                  <a
                    className={item}
                    href={target(code)}
                    hrefLang={code}
                    aria-current={current ? "true" : undefined}
                  >
                    {label}
                  </a>
                )}
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
