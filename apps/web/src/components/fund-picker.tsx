"use client";

import type { Scheme } from "@mf/shared";
import { useEffect, useState } from "react";
import { getSchemes } from "@/lib/api";
import { useI18n } from "@/lib/i18n/client";
import { inputClass } from "./ui";

/**
 * The "add a fund" box shared by compare and basket: a search with a dropdown of
 * matches. Unlike the header search it picks a fund into the page instead of
 * navigating to it.
 */
export function FundPicker({
  label,
  chosen,
  max,
  onPick,
}: {
  label: string;
  chosen: string[];
  max: number;
  onPick: (scheme: Scheme) => void;
}) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Scheme[]>([]);
  const full = chosen.length >= max;

  useEffect(() => {
    if (query.trim().length < 2) {
      setResults([]);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      getSchemes(`q=${encodeURIComponent(query.trim())}&limit=10`)
        .then((response) => !cancelled && setResults(response.items))
        .catch(() => !cancelled && setResults([]));
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query]);

  return (
    <div className="max-w-xl">
      <div className="relative">
        <input
          className={`${inputClass} w-full py-2.5 pl-10`}
          placeholder={full ? t.picker.full(max) : t.picker.placeholder}
          disabled={full}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label={label}
        />
        <svg
          viewBox="0 0 24 24"
          aria-hidden="true"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-ink-500"
        >
          <path d="M12 5v14M5 12h14" />
        </svg>
        {results.length ? (
          <ul className="absolute right-0 left-0 z-20 mt-1.5 panel max-h-80 overflow-y-auto rounded-2xl p-1.5">
            {results.map((scheme) => (
              <li key={scheme.scheme_code}>
                <button
                  className="w-full rounded-xl px-3 py-2 text-left text-sm hover:bg-ink-100 disabled:opacity-40"
                  disabled={chosen.includes(scheme.scheme_code) || full}
                  onClick={() => {
                    onPick(scheme);
                    setQuery("");
                  }}
                >
                  <span className="block font-medium">{scheme.scheme_name}</span>
                  <span className="block text-xs text-ink-500">
                    {scheme.clean_sub_category} · {scheme.clean_plan} · {scheme.clean_option}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      <p className="mt-1.5 text-xs text-ink-500">{t.picker.count(chosen.length, max)}</p>
    </div>
  );
}
