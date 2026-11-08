"use client";

import type { BasketResponse, Scheme } from "@mf/shared";
import { formatPercent, formatRatio } from "@mf/shared";
import { useEffect, useMemo, useState } from "react";
import { FundPicker } from "@/components/fund-picker";
import Link from "@/components/link";
import { Card, inputClass, Stat } from "@/components/ui";
import { MissingValue } from "@/components/metric-cell";
import { postBasket } from "@/lib/api";
import { useI18n } from "@/lib/i18n/client";

const MAX_FUNDS = 10;

type Picked = { scheme_code: string; scheme_name: string; weight: number };

export function BasketClient() {
  const { t, number } = useI18n();
  const b = t.basket;
  const [picked, setPicked] = useState<Picked[]>([]);
  const [result, setResult] = useState<BasketResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const weightSum = picked.reduce((sum, p) => sum + p.weight, 0);
  const normalisedWeights = useMemo(
    () => (weightSum > 0 ? picked.map((p) => p.weight / weightSum) : picked.map(() => 0)),
    [picked, weightSum],
  );

  useEffect(() => {
    if (picked.length === 0 || weightSum <= 0) {
      setResult(null);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    postBasket(
      picked.map((p) => p.scheme_code),
      normalisedWeights,
    )
      .then((r) => {
        if (cancelled) return;
        setResult(r);
        setError(null);
      })
      .catch((err: Error) => {
        if (cancelled) return;
        setError(err.message);
        setResult(null);
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
    // normalisedWeights is derived from picked and weightSum every render; comparing
    // picked/weightSum instead avoids re-fetching on a new-array-same-values render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [picked, weightSum]);

  const addFund = (scheme: Scheme) => {
    if (picked.length >= MAX_FUNDS || picked.some((p) => p.scheme_code === scheme.scheme_code))
      return;
    setPicked((p) => [
      ...p,
      { scheme_code: scheme.scheme_code, scheme_name: scheme.scheme_name, weight: 1 },
    ]);
  };

  const removeFund = (code: string) => setPicked((p) => p.filter((f) => f.scheme_code !== code));
  const equaliseWeights = () => setPicked((p) => p.map((f) => ({ ...f, weight: 1 })));
  const setWeight = (code: string, value: number) =>
    setPicked((p) => p.map((f) => (f.scheme_code === code ? { ...f, weight: value } : f)));

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{b.title}</h1>
        <p className="max-w-3xl text-sm text-ink-500">{b.intro(number(MAX_FUNDS))}</p>
      </header>

      <FundPicker
        label={b.search}
        chosen={picked.map((p) => p.scheme_code)}
        max={MAX_FUNDS}
        onPick={addFund}
      />

      {picked.length ? (
        <Card title={b.weights} subtitle={b.weightsHint}>
          <div
            className="mb-4 flex h-2.5 overflow-hidden rounded-full bg-ink-100"
            aria-hidden="true"
          >
            {picked.map((fund, index) => (
              <span
                key={fund.scheme_code}
                className="h-full"
                style={{
                  width: `${(normalisedWeights[index] ?? 0) * 100}%`,
                  background: SWATCHES[index % SWATCHES.length],
                }}
              />
            ))}
          </div>
          <ul className="divide-y divide-ink-100">
            {picked.map((fund, index) => (
              <li key={fund.scheme_code} className="flex items-center gap-3 py-2.5">
                <FundNumber index={index} />
                <Link
                  href={`/fund/${fund.scheme_code}`}
                  className="min-w-0 flex-1 text-sm font-medium text-ink-900 hover:text-accent-600 hover:underline"
                >
                  {fund.scheme_name}
                </Link>
                <input
                  type="number"
                  min={0}
                  step={0.05}
                  className={`${inputClass} w-20`}
                  value={fund.weight}
                  onChange={(e) => setWeight(fund.scheme_code, Number(e.target.value) || 0)}
                  aria-label={b.weightFor(fund.scheme_name)}
                />
                <span className="w-14 text-right text-sm text-ink-500 numeric">
                  {formatPercent(normalisedWeights[index] ?? 0)}
                </span>
                <button
                  type="button"
                  aria-label={b.remove(fund.scheme_name)}
                  title={b.removeTitle}
                  className="rounded-full px-1.5 text-base leading-6 text-ink-500 hover:bg-ink-100 hover:text-ink-900"
                  onClick={() => removeFund(fund.scheme_code)}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
          <button
            className="mt-3 text-sm font-medium text-accent-600 hover:underline"
            onClick={equaliseWeights}
          >
            {b.equalise}
          </button>
        </Card>
      ) : (
        <div className="rounded-3xl border border-dashed border-ink-300 px-6 py-14 text-center">
          <p className="text-base font-semibold text-ink-900">{b.emptyTitle}</p>
          <p className="mx-auto mt-2 max-w-md text-sm text-ink-500">{b.emptyBody}</p>
        </div>
      )}

      <p className="rounded-2xl border-l-2 border-warn-300 bg-warn-50 p-4 text-sm text-warn-900">
        <strong>{b.notOverlap}</strong> {b.notOverlapBody}
      </p>

      {error ? <p className="text-sm text-bad-700">{error}</p> : null}
      {loading ? <p className="text-sm text-ink-500">{b.scoring}</p> : null}

      {result && result.reason ? (
        <Card title={b.shortHistory}>
          <MissingValue reason={result.reason} description={result.reason_description} />
          <p className="mt-2 text-sm text-ink-500">
            {b.sharedMonths(
              result.matched_months,
              number(result.matched_months),
              number(result.min_observations),
            )}
          </p>
        </Card>
      ) : null}

      {result && result.correlation_matrix && result.blended && result.components ? (
        <BasketResults result={result} picked={picked} />
      ) : null}
    </div>
  );
}

// Even hue steps at mid lightness, readable on both themes; a fund keeps its colour
// and number in the weights bar, the list and the correlation grid.
const SWATCHES = [
  "#4C6FFF",
  "#E5892B",
  "#2EC4B6",
  "#D6456C",
  "#9B5DE5",
  "#2A9D8F",
  "#C9A227",
  "#6C757D",
  "#3FA7D6",
  "#8AB17D",
];

function FundNumber({ index }: { index: number }) {
  return (
    <span
      className="grid size-6 shrink-0 place-items-center rounded-full text-xs font-semibold text-white"
      style={{ background: SWATCHES[index % SWATCHES.length] }}
    >
      {index + 1}
    </span>
  );
}

function Value({
  metric,
  format,
}: {
  metric: { value: number | null; reason?: string | null };
  format: (value: number) => string;
}) {
  return metric.value === null ? (
    <MissingValue reason={metric.reason ?? undefined} />
  ) : (
    <span className="numeric">{format(metric.value)}</span>
  );
}

function correlationColor(rho: number): string {
  // Magnitude only, via opacity of the existing accent token - sign is read from the
  // number itself, so a colourblind or greyscale view still carries the information.
  const opacity = Math.round(Math.min(1, Math.abs(rho)) * 65);
  return `color-mix(in srgb, var(--color-accent-500) ${opacity}%, var(--color-surface))`;
}

function BasketResults({ result, picked }: { result: BasketResponse; picked: Picked[] }) {
  const { t, number } = useI18n();
  const b = t.basket;
  const blended = result.blended!;
  const components = result.components!;
  const matrix = result.correlation_matrix!;
  const codes = matrix.map((row) => row.scheme_code);
  const indexByCode = Object.fromEntries(picked.map((p, i) => [p.scheme_code, i]));
  const nameByCode = Object.fromEntries(picked.map((p) => [p.scheme_code, p.scheme_name]));
  const benefit = result.diversification_benefit!;

  return (
    <div className="space-y-5">
      <section aria-label={b.blended} className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat
          label={b.blendReturn}
          value={<Value metric={blended.cagr} format={formatPercent} />}
        />
        <Stat
          label={b.blendVolatility}
          value={<Value metric={blended.volatility} format={formatPercent} />}
        />
        <Stat
          label={b.blendSharpe}
          value={<Value metric={blended.sharpe} format={formatRatio} />}
        />
        <Stat
          label={b.blendWorstFall}
          value={<Value metric={blended.max_drawdown} format={formatPercent} />}
        />
        <Stat
          label={b.benefit}
          value={<Value metric={benefit} format={formatPercent} />}
          tooltip={b.benefitHint}
        />
      </section>

      <Card
        title={b.correlation}
        subtitle={b.correlationHint(result.matched_months, number(result.matched_months))}
      >
        <div className="scroll-x overflow-x-auto">
          <table className="text-sm">
            <thead>
              <tr>
                <th className="px-2 py-1" />
                {codes.map((code) => (
                  <th key={code} scope="col" className="px-2 py-1.5" title={nameByCode[code]}>
                    <span className="flex justify-center">
                      <FundNumber index={indexByCode[code] ?? 0} />
                    </span>
                    <span className="sr-only">{nameByCode[code] ?? code}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {matrix.map((row) => (
                <tr key={row.scheme_code}>
                  <th
                    scope="row"
                    className="max-w-64 px-2 py-1 text-left text-xs font-medium text-ink-700"
                  >
                    <span className="flex items-center gap-2">
                      <FundNumber index={indexByCode[row.scheme_code] ?? 0} />
                      <span className="truncate">
                        {nameByCode[row.scheme_code] ?? row.scheme_code}
                      </span>
                    </span>
                  </th>
                  {codes.map((col) => {
                    const rho = row.correlations[col] ?? null;
                    return (
                      <td
                        key={col}
                        className="numeric min-w-16 rounded-md border-2 border-surface px-2 py-2 text-center"
                        style={{
                          backgroundColor: rho === null ? undefined : correlationColor(rho),
                        }}
                      >
                        {rho === null ? "-" : formatRatio(rho)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title={b.versus}>
        <div className="scroll-x overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-ink-500 [&_th]:px-3 [&_th]:pb-2 [&_th]:font-medium">
                <th>{b.columns.fund}</th>
                <th>{b.columns.weight}</th>
                <th>{b.columns.return}</th>
                <th>{b.columns.volatility}</th>
                <th>{b.columns.sharpe}</th>
                <th>{b.columns.worstFall}</th>
                <th>{b.columns.upCapture}</th>
                <th>{b.columns.downCapture}</th>
              </tr>
            </thead>
            <tbody className="[&_td]:px-3 [&_td]:py-2.5">
              <tr className="border-t border-ink-200 bg-ink-100 font-semibold">
                <td>{b.blendRow}</td>
                <td className="numeric">{formatPercent(1)}</td>
                <td>
                  <Value metric={blended.cagr} format={formatPercent} />
                </td>
                <td>
                  <Value metric={blended.volatility} format={formatPercent} />
                </td>
                <td>
                  <Value metric={blended.sharpe} format={formatRatio} />
                </td>
                <td>
                  <Value metric={blended.max_drawdown} format={formatPercent} />
                </td>
                <td className="text-ink-300">-</td>
                <td className="text-ink-300">-</td>
              </tr>
              {components.map((c) => (
                <tr key={c.scheme_code} className="border-t border-ink-100">
                  <td>
                    <span className="flex items-center gap-2">
                      <FundNumber index={indexByCode[c.scheme_code] ?? 0} />
                      <Link
                        href={`/fund/${c.scheme_code}`}
                        className="font-medium text-ink-900 hover:text-accent-600 hover:underline"
                      >
                        {nameByCode[c.scheme_code] ?? c.scheme_code}
                      </Link>
                    </span>
                  </td>
                  <td className="numeric">{formatPercent(c.weight)}</td>
                  <td>
                    <Value metric={c.cagr} format={formatPercent} />
                  </td>
                  <td>
                    <Value metric={c.volatility} format={formatPercent} />
                  </td>
                  <td>
                    <Value metric={c.sharpe} format={formatRatio} />
                  </td>
                  <td>
                    <Value metric={c.max_drawdown} format={formatPercent} />
                  </td>
                  <td>
                    <Value metric={c.capture_vs_blended.up} format={formatRatio} />
                  </td>
                  <td>
                    <Value metric={c.capture_vs_blended.down} format={formatRatio} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
