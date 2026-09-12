"use client";

import type { MetricSpec } from "@mf/shared";
import { useState } from "react";
import { Button, inputClass } from "./ui";

// Mirrors PINNED_COLUMNS in the API: the fund name leads the table and stays pinned,
// and every row links and selects by code, so neither can be turned off.
const PINNED_COLUMNS = new Set(["scheme_name", "scheme_code"]);

export function ColumnPicker({
  open,
  onClose,
  selectable,
  selected,
  metrics,
  onChange,
  defaults,
}: {
  open: boolean;
  onClose: () => void;
  selectable: string[];
  selected: string[];
  metrics: Record<string, MetricSpec>;
  onChange: (next: string[]) => void;
  defaults: string[];
}) {
  const [query, setQuery] = useState("");
  if (!open) return null;
  const matches = selectable.filter(
    (name) =>
      name.toLowerCase().includes(query.toLowerCase()) ||
      (metrics[name]?.label ?? "").toLowerCase().includes(query.toLowerCase()),
  );
  const toggle = (name: string) => {
    onChange(selected.includes(name) ? selected.filter((c) => c !== name) : [...selected, name]);
  };
  return (
    <aside
      aria-label="Columns"
      className="fixed inset-y-0 right-0 z-40 flex w-[420px] flex-col border-l border-ink-200 bg-surface shadow-2xl"
    >
      <header className="flex items-center justify-between border-b border-ink-200 px-4 py-3">
        <h2 className="text-sm font-semibold">Columns ({selected.length})</h2>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={() => onChange(defaults)}>
            Reset
          </Button>
          <Button onClick={onClose}>Done</Button>
        </div>
      </header>
      <div className="border-b border-ink-200 px-4 py-3">
        <input
          className={`${inputClass} w-full`}
          placeholder="Search columns"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      <div className="flex-1 space-y-1 overflow-y-auto px-4 py-3">
        {matches.map((name) => (
          <label
            key={name}
            className="flex items-start gap-2 rounded px-1 py-1 text-sm hover:bg-ink-50"
          >
            <input
              type="checkbox"
              className="mt-1"
              checked={selected.includes(name)}
              onChange={() => toggle(name)}
              disabled={PINNED_COLUMNS.has(name)}
            />
            <span>
              <span className="block">{metrics[name]?.label ?? name}</span>
              <span className="block font-mono text-[11px] text-ink-500">{name}</span>
            </span>
          </label>
        ))}
      </div>
    </aside>
  );
}
