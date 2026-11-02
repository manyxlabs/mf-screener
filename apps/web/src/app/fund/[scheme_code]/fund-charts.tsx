"use client";

import { formatPercent, type RollingResponse } from "@mf/shared";
import { useEffect, useState } from "react";
import { NavChart, RollingReturnChart } from "@/components/charts";
import { Card } from "@/components/ui";
import { getRollingReturns, ROLLING_HORIZONS, type RollingHorizon } from "@/lib/api";

function ScaleBreakNote({ at }: { at: string | null }) {
  if (!at) return null;
  return (
    <p className="rounded border border-warn-200 bg-warn-50 px-3 py-2 text-xs text-warn-900 xl:col-span-2">
      <span aria-hidden="true">⚠ </span>
      NAV scale change on {at}: a face-value redenomination or unit split, filed as a raw NAV jump.
      Earlier NAVs are in different units, so every metric here starts at that month.
    </p>
  );
}

export function FundCharts({
  schemeCode,
  navPoints,
}: {
  schemeCode: string;
  navPoints: { date: string; nav: number }[];
}) {
  const [horizon, setHorizon] = useState<RollingHorizon>(5);
  const [rolling, setRolling] = useState<RollingResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getRollingReturns(schemeCode, horizon)
      .then((response) => !cancelled && setRolling(response))
      .catch((err: Error) => !cancelled && setError(err.message));
    return () => {
      cancelled = true;
    };
  }, [schemeCode, horizon]);

  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <ScaleBreakNote at={rolling?.scale_break_at ?? null} />
      <Card
        title={`Rolling ${horizon}-year annualised return`}
        subtitle="Each point is the annualised return of the window ending on that month."
      >
        <div
          role="group"
          aria-label="Window length"
          className="mb-4 inline-flex rounded-lg bg-ink-100 p-1"
        >
          {ROLLING_HORIZONS.map((h) => (
            <button
              key={h}
              type="button"
              aria-pressed={h === horizon}
              onClick={() => setHorizon(h)}
              className={`rounded-md px-3 py-1 text-sm font-medium transition-colors ${
                h === horizon
                  ? "bg-surface text-ink-900 shadow-sm"
                  : "text-ink-500 hover:text-ink-900"
              }`}
            >
              {h}Y
            </button>
          ))}
        </div>
        {error ? <p className="text-sm text-bad-700">{error}</p> : null}
        {rolling ? (
          <>
            <RollingReturnChart fund={rolling.points} category={rolling.category_points} />
            <dl className="mt-3 grid grid-cols-3 gap-2 text-xs sm:grid-cols-6">
              {(
                [
                  ["Mean", rolling.summary.mean],
                  ["Median", rolling.summary.median],
                  ["Minimum", rolling.summary.min],
                  ["Maximum", rolling.summary.max],
                  ["Dispersion", rolling.summary.std],
                  ["Positive", rolling.summary.positive_pct],
                ] as const
              ).map(([label, value]) => (
                <div key={label} className="rounded-lg bg-ink-100 px-2.5 py-2">
                  <dt className="text-ink-500">{label}</dt>
                  <dd className="mt-0.5 text-sm font-medium numeric">{formatPercent(value)}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-2 text-xs text-ink-500">
              n={rolling.summary.window_count} windows
              {rolling.summary.reason ? ` · ${rolling.summary.reason}` : ""}. Overlapping windows
              share months, so they are not independent observations.
            </p>
          </>
        ) : (
          <p className="text-sm text-ink-500">Loading rolling series...</p>
        )}
      </Card>

      <Card
        title="Month-end NAV"
        subtitle={
          rolling?.scale_break_at
            ? "Every NAV as filed with AMFI, including the step at the redenomination."
            : "The series every metric on this page is computed from."
        }
      >
        <NavChart points={navPoints} />
      </Card>
    </div>
  );
}
