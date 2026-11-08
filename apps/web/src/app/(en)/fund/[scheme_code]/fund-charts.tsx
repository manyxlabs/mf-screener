"use client";

import { formatPercent, type RollingResponse } from "@mf/shared";
import { useEffect, useState } from "react";
import { NavChart, RollingReturnChart } from "@/components/charts";
import { Card } from "@/components/ui";
import { getRollingReturns, ROLLING_HORIZONS, type RollingHorizon } from "@/lib/api";
import { useI18n } from "@/lib/i18n/client";

const STATS = ["mean", "median", "min", "max", "std", "positive_pct"] as const;

function ScaleBreakNote({ at }: { at: string | null }) {
  const { t } = useI18n();
  if (!at) return null;
  return (
    <p className="rounded border border-warn-200 bg-warn-50 px-3 py-2 text-xs text-warn-900 xl:col-span-2">
      <span aria-hidden="true">⚠ </span>
      {t.fund.charts.scaleBreak(at)}
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
  const { t } = useI18n();
  const words = t.fund.charts;
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
      <Card title={words.rollingTitle(horizon)} subtitle={words.rollingSubtitle}>
        <div
          role="group"
          aria-label={words.windowLength}
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
              {t.fund.horizon(h)}
            </button>
          ))}
        </div>
        {error ? <p className="text-sm text-bad-700">{error}</p> : null}
        {rolling ? (
          <>
            <RollingReturnChart fund={rolling.points} category={rolling.category_points} />
            <dl className="mt-3 grid grid-cols-3 gap-2 text-xs sm:grid-cols-6">
              {STATS.map((stat) => (
                <div key={stat} className="rounded-lg bg-ink-100 px-2.5 py-2">
                  <dt className="text-ink-500">{words.stats[stat]}</dt>
                  <dd className="mt-0.5 text-sm font-medium numeric">
                    {formatPercent(rolling.summary[stat])}
                  </dd>
                </div>
              ))}
            </dl>
            <p className="mt-2 text-xs text-ink-500">
              {words.windows(rolling.summary.window_count, rolling.summary.reason)}
            </p>
          </>
        ) : (
          <p className="text-sm text-ink-500">{words.loading}</p>
        )}
      </Card>

      <Card
        title={words.navTitle}
        subtitle={rolling?.scale_break_at ? words.navAsFiled : words.navSeries}
      >
        <NavChart points={navPoints} />
      </Card>
    </div>
  );
}
