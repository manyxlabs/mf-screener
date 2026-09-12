"use client";

import type { MetricSpec } from "@mf/shared";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Card, inputClass } from "@/components/ui";
import { CONCEPTS } from "./concepts";

/** The order groups read in, coarse to fine. Anything unrecognised sorts to the end. */
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

function directionText(direction: MetricSpec["direction"]): string {
  if (direction === "higher_is_better") return "Higher is better";
  if (direction === "lower_is_better") return "Lower is better";
  return "Neither direction is better";
}

export function GlossaryClient({ metrics }: { metrics: MetricSpec[] }) {
  const [query, setQuery] = useState("");

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matches = (m: MetricSpec) =>
      !q ||
      m.plain_label.toLowerCase().includes(q) ||
      m.label.toLowerCase().includes(q) ||
      m.name.toLowerCase().includes(q) ||
      m.plain_definition.toLowerCase().includes(q);

    const byGroup = new Map<string, MetricSpec[]>();
    for (const m of metrics.filter(matches)) {
      const list = byGroup.get(m.group) ?? [];
      list.push(m);
      byGroup.set(m.group, list);
    }
    return [...byGroup.entries()].sort((a, b) => {
      const ai = GROUP_ORDER.indexOf(a[0]);
      const bi = GROUP_ORDER.indexOf(b[0]);
      return (ai < 0 ? GROUP_ORDER.length : ai) - (bi < 0 ? GROUP_ORDER.length : bi);
    });
  }, [metrics, query]);

  const shown = groups.reduce((n, [, list]) => n + list.length, 0);

  return (
    <div className="space-y-6">
      <header className="max-w-3xl space-y-2">
        <h1 className="text-xl font-semibold text-ink-900">Glossary</h1>
        <p className="text-sm text-ink-700">
          What each number on this site means and how to read it. For the formula behind any of
          them, and for the rules about when one is refused rather than computed, see{" "}
          <Link className="text-accent-600 underline" href="/methodology">
            methodology
          </Link>
          .
        </p>
      </header>

      <Card
        title="Before you read any number"
        subtitle="Twelve ideas that the rest of this page assumes."
      >
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {CONCEPTS.map((c) => (
            <section key={c.slug} id={c.slug} className="scroll-mt-20">
              <h3 className="text-sm font-semibold text-ink-900">{c.term}</h3>
              <p className="mt-1 text-xs leading-relaxed text-ink-700">{c.body}</p>
              {c.methodologyAnchor ? (
                <Link
                  className="mt-1 inline-block text-[11px] text-accent-600 underline"
                  href={`/methodology#${c.methodologyAnchor}`}
                >
                  How this is computed
                </Link>
              ) : null}
            </section>
          ))}
        </div>
      </Card>

      <div className="flex flex-wrap items-center gap-3">
        <input
          className={`${inputClass} w-72`}
          type="search"
          placeholder="Find a metric"
          aria-label="Find a metric"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <span className="text-xs text-ink-500">
          {shown} of {metrics.length} metrics
        </span>
      </div>

      {shown === 0 ? (
        <p className="text-sm text-ink-500">
          Nothing matches “{query}”. Try the technical name, such as{" "}
          <code className="font-mono">sortino_5y</code>.
        </p>
      ) : null}

      {groups.map(([group, list]) => (
        <Card key={group} title={group}>
          <dl className="grid gap-x-6 gap-y-4 md:grid-cols-2 xl:grid-cols-3">
            {list.map((m) => (
              <div key={m.name} id={`metric-${m.name}`} className="scroll-mt-20">
                <dt className="text-sm font-semibold text-ink-900">{m.plain_label}</dt>
                {/* The technical term is demoted, never dropped: it is what the column
                    header, the CSV export and the API all call this metric. */}
                <dd className="mt-0.5 text-[11px] uppercase tracking-wide text-ink-500">
                  {m.label} <code className="font-mono normal-case">{m.name}</code>
                </dd>
                <dd className="mt-1 text-xs leading-relaxed text-ink-700">{m.plain_definition}</dd>
                <dd className="mt-1 text-xs leading-relaxed text-ink-500">{m.definition}</dd>
                <dd className="mt-1 text-[11px] text-ink-500">
                  {directionText(m.direction)} · {m.period}
                </dd>
                {m.caveat ? (
                  <dd className="mt-1 border-t border-ink-200 pt-1 text-[11px] text-ink-500">
                    Watch out: {m.caveat}
                  </dd>
                ) : null}
              </div>
            ))}
          </dl>
        </Card>
      ))}
    </div>
  );
}
