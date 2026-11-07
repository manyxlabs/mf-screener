"use client";

import type { SearchResult } from "@mf/shared";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { searchSchemes } from "@/lib/api";
import { useI18n } from "@/lib/i18n/client";
import { inputClass } from "./ui";

const DEBOUNCE_MS = 150;

/**
 * Header typeahead over all scheme codes. Every plan/option variant of a fund is a
 * separate row until T2.1 groups them, so each result names its plan and option
 * rather than implying the fund appears once.
 */
/** `size` only widens the box and the type: the header keeps the compact default. */
export function SchemeSearch({ size = "compact" }: { size?: "compact" | "large" } = {}) {
  const { t } = useI18n();
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<SearchResult[] | null>(null);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const requestId = useRef(0);

  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      setItems(null);
      return;
    }
    const id = ++requestId.current;
    const timer = setTimeout(() => {
      searchSchemes(trimmed)
        .then((res) => {
          // A slower earlier request must not overwrite a faster later one.
          if (id === requestId.current) setItems(res.items);
        })
        .catch(() => {
          if (id === requestId.current) setItems([]);
        });
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    function onClickOutside(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  function goTo(result: SearchResult) {
    setOpen(false);
    setQuery("");
    setItems(null);
    router.push(`/fund/${result.scheme_code}`);
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (!open || !items || items.length === 0) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((i) => (i + 1) % items.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((i) => (i <= 0 ? items.length - 1 : i - 1));
    } else if (event.key === "Enter") {
      event.preventDefault();
      const chosen = items[activeIndex] ?? items[0];
      if (chosen) goTo(chosen);
    } else if (event.key === "Escape") {
      setOpen(false);
      setActiveIndex(-1);
    }
  }

  const showPanel = open && query.trim().length > 0;

  return (
    <div
      ref={containerRef}
      // Below sm the header's box is just an input's width, too narrow for a fund name, so
      // the panel is placed against the header bar instead: its backdrop-filter makes that
      // bar the containing block, 13px in from the screen edge (gutter and border).
      className={size === "large" ? "relative w-full" : "w-full max-w-64 min-w-0 sm:relative"}
    >
      <div className="relative">
        <input
          type="text"
          role="combobox"
          aria-expanded={showPanel}
          aria-controls="scheme-search-listbox"
          aria-autocomplete="list"
          aria-activedescendant={
            activeIndex >= 0 ? `scheme-search-option-${activeIndex}` : undefined
          }
          placeholder={size === "large" ? t.search.placeholderLarge : t.search.placeholder}
          aria-label={t.search.label}
          className={`${inputClass} w-full pl-9 ${size === "large" ? "py-3.5 pl-11 text-base" : ""}`}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setActiveIndex(-1);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
        />
        <svg
          viewBox="0 0 24 24"
          aria-hidden="true"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          className={`pointer-events-none absolute top-1/2 -translate-y-1/2 text-ink-500 ${
            size === "large" ? "left-4 size-5" : "left-3 size-4"
          }`}
        >
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" />
        </svg>
      </div>
      {showPanel ? (
        <ul
          id="scheme-search-listbox"
          role="listbox"
          className={`absolute right-0 left-0 z-20 mt-1.5 ${size === "large" ? "" : "max-sm:inset-x-[3px]"}  panel max-h-80 overflow-y-auto rounded-2xl p-1.5 text-left`}
        >
          {items === null ? (
            <li className="px-3 py-2 text-sm text-ink-500">{t.search.searching}</li>
          ) : items.length === 0 ? (
            <li className="px-3 py-2 text-sm text-ink-500">{t.search.noMatch(query.trim())}</li>
          ) : (
            items.map((item, index) => (
              <li
                key={item.scheme_code}
                id={`scheme-search-option-${index}`}
                role="option"
                aria-selected={index === activeIndex}
                className={`cursor-pointer rounded-xl px-3 py-2 text-sm hover:bg-ink-100 ${
                  index === activeIndex ? "bg-ink-100" : ""
                }`}
                onMouseEnter={() => setActiveIndex(index)}
                onMouseDown={(event) => {
                  // mousedown fires before the input's blur/click-outside handler
                  event.preventDefault();
                  goTo(item);
                }}
              >
                <div className="font-medium">{item.scheme_name}</div>
                <div className="text-xs text-ink-500">
                  {item.amc ?? t.search.unknownAmc} · {item.clean_plan ?? "-"} ·{" "}
                  {item.clean_option ?? "-"}
                </div>
              </li>
            ))
          )}
        </ul>
      ) : null}
    </div>
  );
}
