"use client";

import type {
  ColumnsResponse,
  MetricSpec,
  Preset,
  ScoreResponse,
  ScreenResponse,
} from "@mf/shared";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { MetricValue } from "@/components/metric-cell";
import { Badge, Card } from "@/components/ui";
import { getScore, scoreBreakdown } from "./score";

export type Slot = { preset: Preset; screen: ScreenResponse };

const KEY = "mf-screener.picks.v1";

/** The chosen scheme code per slot id, in this browser only. */
function loadPicks(): Record<string, string> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, string>) : {};
  } catch {
    return {};
  }
}

export function PicksClient({
  slots,
  columnsMeta,
}: {
  slots: Slot[];
  columnsMeta: ColumnsResponse;
}) {
  const metrics = useMemo(
    () =>
      Object.fromEntries(columnsMeta.metrics.map((m) => [m.name, m])) as Record<string, MetricSpec>,
    [columnsMeta.metrics],
  );
  const [picks, setPicks] = useState<Record<string, string>>({});
  const [ready, setReady] = useState(false);
  const [scores, setScores] = useState<Record<string, ScoreResponse>>({});

  useEffect(() => {
    setPicks(loadPicks());
    setReady(true);
  }, []);

  // Every candidate shown gets its composite score, so "why is this ranked above
  // that" is on screen without a click. A fund the score endpoint can't score (no
  // metrics, too few peers) is simply left without a badge rather than erroring.
  useEffect(() => {
    const codes = new Set(
      slots.flatMap((slot) => slot.screen.rows.map((row) => String(row["scheme_code"]))),
    );
    let cancelled = false;
    void Promise.allSettled([...codes].map((code) => getScore(code))).then((results) => {
      if (cancelled) return;
      const next: Record<string, ScoreResponse> = {};
      for (const result of results) {
        if (result.status === "fulfilled") next[result.value.scheme_code] = result.value;
      }
      setScores(next);
    });
    return () => {
      cancelled = true;
    };
  }, [slots]);

  const choose = (slotId: string, code: string) => {
    setPicks((current) => {
      // Clicking the current pick clears the slot, so a sleeve can be left undecided.
      const next = { ...current };
      if (next[slotId] === code) delete next[slotId];
      else next[slotId] = code;
      window.localStorage.setItem(KEY, JSON.stringify(next));
      return next;
    });
  };

  const chosen = slots.map((slot) => picks[slot.preset.id]).filter(Boolean) as string[];

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end gap-3">
        <div className="mr-auto">
          <h1 className="text-lg font-semibold tracking-tight">Portfolio slots</h1>
          <p className="mt-0.5 text-xs text-ink-500">
            One fund per sleeve. Each sleeve is ranked by the criteria that suit its mandate, so the
            columns differ between them on purpose. Editable as a preset in the screener. The number
            beside each fund is its composite score out of 100: a weighted percentile against its
            own sub-category peers, blending the 3-, 5- and 10-year reading of each component. Hover
            it for the breakdown; * marks a score missing a component (named, never imputed, and the
            remaining weights renormalised so a short record is not itself a penalty).
          </p>
        </div>
        <span className="text-xs text-ink-500">
          {ready ? `${chosen.length} of ${slots.length} chosen` : " "}
        </span>
        {chosen.length >= 2 ? (
          <Link
            className="rounded-md border border-accent-500 bg-accent-500 px-3 py-1.5 text-sm font-medium text-on-accent"
            href={`/compare?codes=${chosen.join(",")}`}
          >
            Compare your {chosen.length} side by side
          </Link>
        ) : (
          <span className="text-xs text-ink-500">Choose at least two to compare.</span>
        )}
      </header>

      <div className="grid gap-4 xl:grid-cols-2">
        {slots.map(({ preset, screen }) => (
          <Card
            key={preset.id}
            title={
              <span className="flex items-baseline gap-2">
                {preset.slot}
                <Link
                  className="text-xs font-normal text-accent-600 underline"
                  href={`/screener?preset=${preset.id}`}
                >
                  open in screener
                </Link>
              </span>
            }
            subtitle={preset.description}
          >
            {screen.rows.length === 0 ? (
              <p className="py-6 text-center text-sm text-ink-500">
                No fund currently meets this sleeve&apos;s criteria. Loosen it in the screener.
              </p>
            ) : (
              <ul className="space-y-1.5">
                {screen.rows.map((row) => {
                  const code = String(row["scheme_code"]);
                  const picked = picks[preset.id] === code;
                  return (
                    // The metric line sits outside the select button, not inside it: a
                    // blank metric carries an explain-tooltip, which is itself a button,
                    // and a button inside a button is invalid HTML that fails hydration.
                    <li
                      key={code}
                      className={`rounded-md border px-3 py-2 transition-colors ${
                        picked
                          ? "border-accent-500 bg-accent-50"
                          : "border-ink-200 hover:bg-ink-100"
                      }`}
                    >
                      <button
                        type="button"
                        aria-pressed={picked}
                        onClick={() => choose(preset.id, code)}
                        className="flex w-full items-start gap-2 text-left"
                      >
                        <span className="flex-1 text-sm font-medium text-ink-900">
                          {String(row["scheme_name"])}
                        </span>
                        <ScoreBadge score={scores[code]} />
                        {picked ? <Badge tone="good">Picked</Badge> : null}
                      </button>
                      <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs">
                        {(preset.highlight ?? []).map((name) => (
                          <span key={name} className="text-ink-500">
                            {metrics[name]?.label ?? name}{" "}
                            <MetricValue
                              value={row[name]}
                              spec={metrics[name]}
                              reason={reasonFor(row, name)}
                              reasonDescription={
                                columnsMeta.missing_reasons[reasonFor(row, name) ?? ""]
                              }
                            />
                          </span>
                        ))}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
            <p className="mt-3 text-right text-xs text-ink-500">
              <Link className="underline" href={`/screener?preset=${preset.id}`}>
                {screen.total} match this sleeve
              </Link>
            </p>
          </Card>
        ))}
      </div>

      <Card title="Your sleeves">
        <ul className="space-y-1 text-sm">
          {slots.map(({ preset, screen }) => {
            const code = picks[preset.id];
            const row = screen.rows.find((r) => String(r["scheme_code"]) === code);
            return (
              <li key={preset.id} className="flex gap-2">
                <span className="w-40 shrink-0 text-ink-500">{preset.slot}</span>
                {row ? (
                  <Link className="text-accent-600 underline" href={`/fund/${code}`}>
                    {String(row["scheme_name"])}
                  </Link>
                ) : (
                  <span className="text-ink-500">not chosen yet</span>
                )}
              </li>
            );
          })}
        </ul>
        <p className="mt-3 text-xs text-ink-500">
          Your picks are kept in this browser only and are never sent anywhere. Analytics and
          research only, not investment advice.
        </p>
      </Card>
    </div>
  );
}

/**
 * The composite score, out of 100. `title` carries the full per-component
 * breakdown so the reason for the ranking is a hover away, not hidden behind a
 * second page. Never labelled a rating: a score is a percentile decomposition.
 */
function ScoreBadge({ score }: { score: ScoreResponse | undefined }) {
  if (!score || score.total === null) return null;
  return (
    <span
      title={scoreBreakdown(score)}
      className="shrink-0 rounded border border-ink-200 px-1.5 py-0.5 text-xs font-medium text-ink-700"
    >
      {Math.round(score.total)}
      {score.status === "partial" ? "*" : ""}
    </span>
  );
}

/** The screen carries a per-column reason for every null it returns. */
function reasonFor(row: Record<string, unknown>, name: string): string | undefined {
  const reasons = row["missing_reasons"];
  if (!reasons || typeof reasons !== "object") return undefined;
  const value = (reasons as Record<string, unknown>)[name];
  return typeof value === "string" ? value : undefined;
}
