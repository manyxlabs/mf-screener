"use client";

import { formatPercent, type RollingResponse } from "@mf/shared";
import { useEffect, useState } from "react";
import { NavChart, RollingReturnChart } from "@/components/charts";
import { Button, Card } from "@/components/ui";
import { getRollingReturns } from "@/lib/api";

const HORIZONS = [1, 3, 5, 10];

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
  const [horizon, setHorizon] = useState(5);
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
        <div className="mb-3 flex gap-2">
          {HORIZONS.map((h) => (
            <Button
              key={h}
              variant={h === horizon ? "primary" : "secondary"}
              onClick={() => setHorizon(h)}
            >
              {h}Y
            </Button>
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
                <div key={label} className="rounded border border-ink-200 px-2 py-1.5">
                  <dt className="text-ink-500">{label}</dt>
                  <dd className="numeric">{formatPercent(value)}</dd>
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
