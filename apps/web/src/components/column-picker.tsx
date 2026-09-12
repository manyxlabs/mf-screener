"use client";

import type { MetricSpec } from "@mf/shared";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Button, inputClass } from "./ui";

// Mirrors PINNED_COLUMNS in the API: the fund name leads the table and stays pinned,
// and every row links and selects by code, so neither can be turned off.
const PINNED_COLUMNS = new Set(["scheme_name", "scheme_code"]);

/** Coarse to fine, matching the glossary. Unrecognised groups sort to the end. */
const GROUP_ORDER = [
  "Returns",
  "Rolling returns",
  "Vs similar funds",
  "Vs index",
  "Risk",
  "Drawdown",
  "Rank stability",
  "Costs & terms",
  "Size",
  "Fund basics",
];

const UNGROUPED = "Other";

export function ColumnPicker({
  open,
  onClose,
  selectable,
  selected,
  metrics,
  onChange,
  defaults,
  starter,
}: {
  open: boolean;
  onClose: () => void;
  selectable: string[];
  selected: string[];
  metrics: Record<string, MetricSpec>;
  onChange: (next: string[]) => void;
  defaults: string[];
  starter: string[];
}) {
  const [query, setQuery] = useState("");

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matches = (name: string) => {
      if (!q) return true;
      const spec = metrics[name];
      return (
        name.toLowerCase().includes(q) ||
        (spec?.label ?? "").toLowerCase().includes(q) ||
        (spec?.plain_label ?? "").toLowerCase().includes(q)
      );
    };
    const byGroup = new Map<string, string[]>();
    for (const name of selectable.filter(matches)) {
      const key = metrics[name]?.group || UNGROUPED;
      byGroup.set(key, [...(byGroup.get(key) ?? []), name]);
    }
    return [...byGroup.entries()].sort((a, b) => {
      const ai = GROUP_ORDER.indexOf(a[0]);
      const bi = GROUP_ORDER.indexOf(b[0]);
      return (ai < 0 ? GROUP_ORDER.length : ai) - (bi < 0 ? GROUP_ORDER.length : bi);
    });
  }, [selectable, metrics, query]);

  if (!open) return null;

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
        <Button onClick={onClose}>Done</Button>
      </header>
      <div className="space-y-3 border-b border-ink-200 px-4 py-3">
        {/* Three named sets rather than a Reset button, so the 168-column list is a
            place you choose to go rather than the only alternative to the default. */}
        <div className="flex gap-2 text-xs">
          <Button variant="ghost" onClick={() => onChange(starter)}>
            Starter
          </Button>
          <Button variant="ghost" onClick={() => onChange(defaults)}>
            Standard
          </Button>
          <Button variant="ghost" onClick={() => onChange(selectable)}>
            Everything
          </Button>
        </div>
        <input
          className={`${inputClass} w-full`}
          placeholder="Search columns"
          aria-label="Search columns"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      <div className="flex-1 overflow-y-auto px-4 py-3">
        {groups.map(([group, names]) => (
          <section key={group} className="mb-4">
            <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-500">
              {group}
            </h3>
            {names.map((name) => {
              const spec = metrics[name];
              const plain = spec?.plain_label || spec?.label || name;
              return (
                <div
                  key={name}
                  className="flex items-start gap-2 rounded px-1 py-1 text-sm hover:bg-ink-50"
                >
                  <label className="flex flex-1 items-start gap-2">
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={selected.includes(name)}
                      onChange={() => toggle(name)}
                      disabled={PINNED_COLUMNS.has(name)}
                    />
                    <span>
                      <span className="block">{plain}</span>
                      {spec && spec.label !== plain ? (
                        <span className="block text-[11px] text-ink-500">{spec.label}</span>
                      ) : null}
                      <span className="block font-mono text-[11px] text-ink-500">{name}</span>
                    </span>
                  </label>
                  {spec ? (
                    <Link
                      href={`/glossary#metric-${name}`}
                      className="mt-0.5 text-[11px] text-accent-600 underline"
                      aria-label={`What ${plain} means`}
                    >
                      ?
                    </Link>
                  ) : null}
                </div>
              );
            })}
          </section>
        ))}
      </div>
    </aside>
  );
}
