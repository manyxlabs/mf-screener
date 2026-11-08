"use client";

import type { MetricSpec } from "@mf/shared";
import { useMemo, useState } from "react";
import Link from "@/components/link";
import { Badge, inputClass } from "@/components/ui";
import { useI18n } from "@/lib/i18n/client";
import { CONCEPTS } from "./concepts";

/**
 * The order groups read in, coarse to fine, by the English group name, which also
 * makes the anchor id so it is the same in every language. Anything unrecognised
 * sorts to the end.
 */
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

export function GlossaryClient({ metrics }: { metrics: MetricSpec[] }) {
  const { t, td } = useI18n();
  const [query, setQuery] = useState("");

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matches = (m: MetricSpec) =>
      !q ||
      td(m.plain_label).toLowerCase().includes(q) ||
      td(m.label).toLowerCase().includes(q) ||
      m.name.toLowerCase().includes(q) ||
      td(m.plain_definition).toLowerCase().includes(q);

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
  }, [metrics, query, td]);

  const shown = groups.reduce((n, [, list]) => n + list.length, 0);

  return (
    <div className="space-y-8">
      <header className="max-w-3xl space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{t.glossary.title}</h1>
        <p className="text-base text-ink-500">
          {t.glossary.introBefore}
          <Link className="text-accent-600 hover:underline" href="/methodology">
            {t.glossary.introLink}
          </Link>
          {t.glossary.introAfter}
        </p>
      </header>

      <div className="grid gap-8 lg:grid-cols-[14rem_1fr]">
        <aside className="space-y-4 lg:sticky lg:top-24 lg:self-start">
          <input
            className={`${inputClass} w-full`}
            type="search"
            placeholder={t.glossary.find}
            aria-label={t.glossary.find}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <nav aria-label={t.glossary.sections} className="hidden text-sm lg:block">
            <a
              href="#concepts"
              className="block rounded-full px-3 py-1.5 font-medium text-ink-900 hover:bg-ink-900/5"
            >
              {t.glossary.conceptsTitle}
            </a>
            {groups.map(([group, list]) => (
              <a
                key={group}
                href={`#${groupId(group)}`}
                className="flex justify-between rounded-full px-3 py-1.5 text-ink-700 hover:bg-ink-900/5 hover:text-ink-900"
              >
                {td(group)}
                <span className="text-ink-500 numeric">{list.length}</span>
              </a>
            ))}
          </nav>
        </aside>

        <div className="min-w-0 space-y-12">
          <section id="concepts" className="space-y-4">
            <div>
              <h2 className="text-xl font-semibold tracking-tight text-ink-900">
                {t.glossary.conceptsTitle}
              </h2>
              <p className="mt-1 text-sm text-ink-500">
                {t.glossary.conceptsCount(CONCEPTS.length)}
              </p>
            </div>
            <div className="grid gap-4 xl:grid-cols-2">
              {CONCEPTS.map((c) => (
                <section
                  key={c.slug}
                  id={c.slug}
                  className="panel flex flex-col rounded-3xl p-6 target:outline-2 target:outline-accent-500/70"
                >
                  <h3 className="text-base font-semibold tracking-tight text-ink-900">
                    {t.glossary.concepts[c.slug].term}
                  </h3>
                  <p className="mt-2 text-sm leading-relaxed text-ink-700">
                    {t.glossary.concepts[c.slug].body}
                  </p>
                  <Link
                    className="mt-auto pt-3 text-sm font-medium text-accent-600 hover:underline"
                    href={`/methodology#${c.methodologyAnchor}`}
                  >
                    {t.glossary.howComputed}
                  </Link>
                </section>
              ))}
            </div>
          </section>

          <p className="text-sm text-ink-500">
            {t.glossary.shown(shown, metrics.length, query.trim())}
          </p>

          {shown === 0 ? (
            <p className="text-sm text-ink-500">
              {t.glossary.noMatchBefore(query)}
              <code className="font-mono">sortino_5y</code>
              {t.glossary.noMatchAfter}
            </p>
          ) : null}

          {groups.map(([group, list]) => (
            <section key={group} id={groupId(group)} className="space-y-4">
              <h2 className="text-xl font-semibold tracking-tight text-ink-900">{td(group)}</h2>
              <dl className="grid gap-4 xl:grid-cols-2">
                {list.map((m) => (
                  <div
                    key={m.name}
                    id={`metric-${m.name}`}
                    className="panel rounded-3xl p-6 target:outline-2 target:outline-accent-500/70"
                  >
                    <dt className="text-base font-semibold tracking-tight text-ink-900">
                      {td(m.plain_label)}
                    </dt>
                    {/* The technical term is demoted, never dropped: it is what the column
                        header, the CSV export and the API all call this metric. */}
                    <dd className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-500">
                      {td(m.label)}
                      <code className="rounded bg-ink-100 px-1.5 py-0.5 font-mono">{m.name}</code>
                    </dd>
                    <dd className="mt-3 text-sm leading-relaxed text-ink-700">
                      {td(m.plain_definition)}
                    </dd>
                    <dd className="mt-2 text-xs leading-relaxed text-ink-500">
                      {td(m.definition)}
                    </dd>
                    <dd className="mt-3 flex flex-wrap gap-1.5">
                      <Badge>{t.glossary.direction[m.direction]}</Badge>
                      <Badge>{td(m.period)}</Badge>
                    </dd>
                    {m.caveat ? (
                      <dd className="mt-3 border-l-2 border-warn-300 pl-3 text-xs leading-relaxed text-ink-500">
                        {td(m.caveat)}
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
