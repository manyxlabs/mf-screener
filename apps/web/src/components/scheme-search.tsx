"use client";

import type { SearchResult } from "@mf/shared";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { searchSchemes } from "@/lib/api";
import { inputClass } from "./ui";

const DEBOUNCE_MS = 150;

/**
 * Header typeahead over all scheme codes. Every plan/option variant of a fund is a
 * separate row until T2.1 groups them, so each result names its plan and option
 * rather than implying the fund appears once.
 */
/** `size` only widens the box and the type: the header keeps the compact default. */
export function SchemeSearch({ size = "compact" }: { size?: "compact" | "large" } = {}) {
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
    <div ref={containerRef} className={`relative ${size === "large" ? "w-full" : "w-64"}`}>
      <input
        type="text"
        role="combobox"
        aria-expanded={showPanel}
        aria-controls="scheme-search-listbox"
        aria-autocomplete="list"
        aria-activedescendant={activeIndex >= 0 ? `scheme-search-option-${activeIndex}` : undefined}
        placeholder={
          size === "large" ? "Search any fund by name or AMC…" : "Search schemes or AMC…"
        }
        className={`${inputClass} w-full ${size === "large" ? "py-2.5 text-base" : ""}`}
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setActiveIndex(-1);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
      />
      {showPanel ? (
        <ul
          id="scheme-search-listbox"
          role="listbox"
          className="absolute left-0 right-0 z-20 mt-1 max-h-80 overflow-y-auto rounded-md border border-ink-200 bg-surface shadow-lg"
        >
          {items === null ? (
            <li className="px-3 py-2 text-sm text-ink-500">Searching…</li>
          ) : items.length === 0 ? (
            <li className="px-3 py-2 text-sm text-ink-500">
              No schemes match &ldquo;{query.trim()}&rdquo;.
            </li>
          ) : (
            items.map((item, index) => (
              <li
                key={item.scheme_code}
                id={`scheme-search-option-${index}`}
                role="option"
                aria-selected={index === activeIndex}
                className={`cursor-pointer px-3 py-2 text-sm ${
                  index === activeIndex ? "bg-accent-500 text-on-accent" : "hover:bg-ink-100"
                }`}
                onMouseEnter={() => setActiveIndex(index)}
                onMouseDown={(event) => {
                  // mousedown fires before the input's blur/click-outside handler
                  event.preventDefault();
                  goTo(item);
                }}
              >
                <div className="font-medium">{item.scheme_name}</div>
                <div
                  className={`text-xs ${
                    index === activeIndex ? "text-on-accent/80" : "text-ink-500"
                  }`}
                >
                  {item.amc ?? "Unknown AMC"} · {item.clean_plan ?? "-"} ·{" "}
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
