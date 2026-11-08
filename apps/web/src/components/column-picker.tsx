"use client";

import type { MetricSpec } from "@mf/shared";
import { useMemo, useState } from "react";
import Link from "@/components/link";
import { useI18n } from "@/lib/i18n/client";
import { Button, drawerClass, inputClass } from "./ui";

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
  const { t, td } = useI18n();
  const [query, setQuery] = useState("");

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matches = (name: string) => {
      if (!q) return true;
      const spec = metrics[name];
      // English matches too, since the technical labels are what other sites print.
      return [
        name,
        spec?.label,
        spec?.plain_label,
        td(spec?.label ?? ""),
        td(spec?.plain_label ?? ""),
      ].some((text) => text?.toLowerCase().includes(q));
    };
    const byGroup = new Map<string, string[]>();
    for (const name of selectable.filter(matches)) {
      const key = metrics[name]?.group || "";
      byGroup.set(key, [...(byGroup.get(key) ?? []), name]);
    }
    return [...byGroup.entries()].sort((a, b) => {
      const ai = GROUP_ORDER.indexOf(a[0]);
      const bi = GROUP_ORDER.indexOf(b[0]);
      return (ai < 0 ? GROUP_ORDER.length : ai) - (bi < 0 ? GROUP_ORDER.length : bi);
    });
  }, [selectable, metrics, query, td]);

  if (!open) return null;

  const toggle = (name: string) => {
    onChange(selected.includes(name) ? selected.filter((c) => c !== name) : [...selected, name]);
  };

  return (
    <aside aria-label={t.columnPicker.label} className={drawerClass}>
      <header className="flex items-center justify-between border-b border-ink-200 px-4 py-3">
        <h2 className="text-sm font-semibold">{t.columnPicker.title(selected.length)}</h2>
        <Button onClick={onClose}>{t.common.done}</Button>
      </header>
      <div className="space-y-3 border-b border-ink-200 px-4 py-3">
        {/* Three named sets rather than a Reset button, so the 168-column list is a
            place you choose to go rather than the only alternative to the default. */}
        <div className="flex gap-2 text-xs">
          <Button variant="ghost" onClick={() => onChange(starter)}>
            {t.columnPicker.starter}
          </Button>
          <Button variant="ghost" onClick={() => onChange(defaults)}>
            {t.columnPicker.standard}
          </Button>
          <Button variant="ghost" onClick={() => onChange(selectable)}>
            {t.columnPicker.everything}
          </Button>
        </div>
        <input
          className={`${inputClass} w-full`}
          placeholder={t.columnPicker.search}
          aria-label={t.columnPicker.search}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      <div className="flex-1 overflow-y-auto px-4 py-3">
        {groups.map(([group, names]) => (
          <section key={group} className="mb-4">
            <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-500">
              {group ? td(group) : t.columnPicker.other}
            </h3>
            {names.map((name) => {
              const spec = metrics[name];
              const plain = td(spec?.plain_label || spec?.label || name);
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
                      {spec && spec.label !== (spec.plain_label || spec.label) ? (
                        <span className="block text-[11px] text-ink-500">{td(spec.label)}</span>
                      ) : null}
                      <span className="block font-mono text-[11px] text-ink-500">{name}</span>
                    </span>
                  </label>
                  {spec ? (
                    <Link
                      href={`/glossary#metric-${name}`}
                      className="mt-0.5 text-[11px] text-accent-600 underline"
                      aria-label={t.columnPicker.whatItMeans(plain)}
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
