"use client";

import { formatPercent } from "@mf/shared";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

// A fixed categorical palette, not the semantic accent/good/warn/bad tokens: a style
// factor is not "good" or "bad", and the basis can hold more series than those tokens
// give. Chosen for even hue spacing and mid lightness, which reads on both themes.
const CATEGORY_PALETTE = [
  "#4C6FFF",
  "#E5892B",
  "#2EC4B6",
  "#D6456C",
  "#9B5DE5",
  "#2A9D8F",
  "#C9A227",
  "#6C757D",
];

export type SeriesPoint = { date: string; value: number };

const AXIS = { stroke: "var(--color-ink-500)", fontSize: 11 };

// Recharts hardcodes a white tooltip panel, which in dark mode leaves light text on
// light. Both charts take their surface and text from the same tokens as everything else.
const TOOLTIP = {
  contentStyle: {
    background: "var(--color-surface)",
    border: "1px solid var(--color-ink-200)",
    borderRadius: 6,
    boxShadow: "0 4px 12px rgb(0 0 0 / 0.18)",
    fontSize: 12,
  },
  labelStyle: { color: "var(--color-ink-900)", fontWeight: 600, marginBottom: 2 },
  itemStyle: { color: "var(--color-ink-700)" },
  cursor: { stroke: "var(--color-ink-300)" },
} as const;

function mergeSeries(series: { key: string; points: SeriesPoint[] }[]) {
  const byDate = new Map<string, Record<string, number | string>>();
  for (const { key, points } of series) {
    for (const point of points) {
      const row = byDate.get(point.date) ?? { date: point.date };
      row[key] = point.value;
      byDate.set(point.date, row);
    }
  }
  return [...byDate.values()].sort((a, b) => String(a["date"]).localeCompare(String(b["date"])));
}

export function RollingReturnChart({
  fund,
  category,
  benchmarkLabel,
  height = 320,
}: {
  fund: SeriesPoint[];
  category?: SeriesPoint[];
  benchmarkLabel?: string;
  height?: number;
}) {
  if (fund.length === 0) {
    return (
      <p className="py-10 text-center text-sm text-ink-500">
        Not enough NAV history to draw a rolling series at this horizon.
      </p>
    );
  }
  const data = mergeSeries([
    { key: "fund", points: fund },
    ...(category && category.length ? [{ key: "category", points: category }] : []),
  ]);
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 8, right: 12, bottom: 4, left: 4 }}>
        <CartesianGrid stroke="var(--color-ink-100)" />
        <XAxis dataKey="date" tick={AXIS} minTickGap={48} />
        <YAxis tick={AXIS} tickFormatter={(v: number) => formatPercent(v, 0)} width={56} />
        <ReferenceLine y={0} stroke="var(--color-ink-300)" />
        <Tooltip
          {...TOOLTIP}
          formatter={(value: number, name: string) => [formatPercent(value), name]}
          labelFormatter={(label: string) => `Window ending ${label}`}
        />
        <Legend verticalAlign="top" height={28} />
        <Line
          type="monotone"
          dataKey="fund"
          name="Fund"
          stroke="var(--color-accent-500)"
          dot={false}
          strokeWidth={1.8}
        />
        {category && category.length ? (
          <Line
            type="monotone"
            dataKey="category"
            name={benchmarkLabel ?? "Sub-category average"}
            stroke="var(--color-bad-700)"
            strokeDasharray="4 3"
            dot={false}
            strokeWidth={1.5}
          />
        ) : null}
      </LineChart>
    </ResponsiveContainer>
  );
}

export function NavChart({
  points,
  height = 260,
}: {
  points: { date: string; nav: number }[];
  height?: number;
}) {
  if (points.length === 0) {
    return <p className="py-10 text-center text-sm text-ink-500">No NAV history stored.</p>;
  }
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={points} margin={{ top: 8, right: 12, bottom: 4, left: 4 }}>
        <CartesianGrid stroke="var(--color-ink-100)" />
        <XAxis dataKey="date" tick={AXIS} minTickGap={48} />
        <YAxis tick={AXIS} width={56} domain={["auto", "auto"]} />
        <Tooltip {...TOOLTIP} formatter={(v: number) => v.toFixed(4)} />
        <Line
          type="monotone"
          dataKey="nav"
          name="NAV"
          stroke="var(--color-accent-500)"
          dot={false}
          strokeWidth={1.6}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

export type StyleDriftPoint = {
  end_date: string;
  weights: { benchmark_name: string; weight: number }[];
};

/**
 * A window that failed its R-squared floor is never in `points` (the API drops it
 * rather than repeat the previous window's weights), so a gap in the x-axis here is
 * that refusal, not a rendering bug.
 */
export function StyleDriftChart({
  points,
  height = 280,
}: {
  points: StyleDriftPoint[];
  height?: number;
}) {
  if (points.length === 0) {
    return (
      <p className="py-10 text-center text-sm text-ink-500">
        Not enough fitted rolling windows to chart a style mix over time.
      </p>
    );
  }
  const names = [...new Set(points.flatMap((p) => p.weights.map((w) => w.benchmark_name)))];
  const data = points.map((p) => {
    const row: Record<string, number | string> = { date: p.end_date };
    for (const name of names) row[name] = 0;
    for (const w of p.weights) row[w.benchmark_name] = w.weight;
    return row;
  });
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 8, right: 12, bottom: 4, left: 4 }}>
        <CartesianGrid stroke="var(--color-ink-100)" />
        <XAxis dataKey="date" tick={AXIS} minTickGap={48} />
        <YAxis
          tick={AXIS}
          tickFormatter={(v: number) => formatPercent(v, 0)}
          width={48}
          domain={[0, 1]}
        />
        <Tooltip
          {...TOOLTIP}
          formatter={(value: number, name: string) => [formatPercent(value), name]}
          labelFormatter={(label: string) => `Window ending ${label}`}
        />
        <Legend verticalAlign="top" height={28} />
        {names.map((name, i) => (
          <Area
            key={name}
            type="monotone"
            dataKey={name}
            name={name}
            stackId="style"
            stroke={CATEGORY_PALETTE[i % CATEGORY_PALETTE.length]}
            fill={CATEGORY_PALETTE[i % CATEGORY_PALETTE.length]}
            fillOpacity={0.75}
          />
        ))}
      </AreaChart>
    </ResponsiveContainer>
  );
}
