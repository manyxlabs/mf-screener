"use client";

import type { MetricSpec } from "@mf/shared";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Badge, inputClass } from "@/components/ui";
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

const groupId = (group: string) => `group-${group.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;

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
    <div className="space-y-8">
      <header className="max-w-3xl space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight text-ink-900">Glossary</h1>
        <p className="text-base text-ink-500">
          What each number on this site means and how to read it. For the formula behind any of
          them, and for the rules about when one is refused rather than computed, see{" "}
          <Link className="text-accent-600 hover:underline" href="/methodology">
            methodology
          </Link>
          .
        </p>
      </header>

      <div className="grid gap-8 lg:grid-cols-[14rem_1fr]">
        <aside className="space-y-4 lg:sticky lg:top-24 lg:self-start">
          <input
            className={`${inputClass} w-full`}
            type="search"
            placeholder="Find a metric"
            aria-label="Find a metric"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <nav aria-label="Glossary sections" className="hidden text-sm lg:block">
            <a
              href="#concepts"
              className="block rounded-lg px-3 py-1.5 font-medium text-ink-900 hover:bg-ink-900/5"
            >
              Before you read any number
            </a>
            {groups.map(([group, list]) => (
              <a
                key={group}
                href={`#${groupId(group)}`}
                className="flex justify-between rounded-lg px-3 py-1.5 text-ink-700 hover:bg-ink-900/5 hover:text-ink-900"
              >
                {group}
                <span className="text-ink-500 numeric">{list.length}</span>
              </a>
            ))}
          </nav>
        </aside>

        <div className="min-w-0 space-y-12">
          <section id="concepts" className="space-y-4">
            <div>
              <h2 className="text-xl font-semibold tracking-tight text-ink-900">
                Before you read any number
              </h2>
              <p className="mt-1 text-sm text-ink-500">
                {CONCEPTS.length} ideas that the rest of this page assumes.
              </p>
            </div>
            <div className="grid gap-4 xl:grid-cols-2">
              {CONCEPTS.map((c) => (
                <section
                  key={c.slug}
                  id={c.slug}
                  className="flex flex-col rounded-xl border border-ink-200 bg-surface p-5 shadow-card target:border-accent-500 target:ring-3 target:ring-accent-500/15"
                >
                  <h3 className="text-base font-semibold tracking-tight text-ink-900">{c.term}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-ink-700">{c.body}</p>
                  {c.methodologyAnchor ? (
                    <Link
                      className="mt-auto pt-3 text-sm font-medium text-accent-600 hover:underline"
                      href={`/methodology#${c.methodologyAnchor}`}
                    >
                      How this is computed →
                    </Link>
                  ) : null}
                </section>
              ))}
            </div>
          </section>

          <p className="text-sm text-ink-500">
            {shown} of {metrics.length} metrics{query.trim() ? ` match “${query.trim()}”` : ""}
          </p>

          {shown === 0 ? (
            <p className="text-sm text-ink-500">
              Nothing matches “{query}”. Try the technical name, such as{" "}
              <code className="font-mono">sortino_5y</code>.
            </p>
          ) : null}

          {groups.map(([group, list]) => (
            <section key={group} id={groupId(group)} className="space-y-4">
              <h2 className="text-xl font-semibold tracking-tight text-ink-900">{group}</h2>
              <dl className="grid gap-4 xl:grid-cols-2">
                {list.map((m) => (
                  <div
                    key={m.name}
                    id={`metric-${m.name}`}
                    className="rounded-xl border border-ink-200 bg-surface p-5 shadow-card target:border-accent-500 target:ring-3 target:ring-accent-500/15"
                  >
                    <dt className="text-base font-semibold tracking-tight text-ink-900">
                      {m.plain_label}
                    </dt>
                    {/* The technical term is demoted, never dropped: it is what the column
                        header, the CSV export and the API all call this metric. */}
                    <dd className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-500">
                      {m.label}
                      <code className="rounded bg-ink-100 px-1.5 py-0.5 font-mono">{m.name}</code>
                    </dd>
                    <dd className="mt-3 text-sm leading-relaxed text-ink-700">
                      {m.plain_definition}
                    </dd>
                    <dd className="mt-2 text-xs leading-relaxed text-ink-500">{m.definition}</dd>
                    <dd className="mt-3 flex flex-wrap gap-1.5">
                      <Badge>{directionText(m.direction)}</Badge>
                      <Badge>{m.period}</Badge>
                    </dd>
                    {m.caveat ? (
                      <dd className="mt-3 border-l-2 border-warn-300 pl-3 text-xs leading-relaxed text-ink-500">
                        {m.caveat}
                      </dd>
                    ) : null}
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
