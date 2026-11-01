"use client";

import type { BasketResponse, Scheme } from "@mf/shared";
import { formatCount, formatPercent, formatRatio } from "@mf/shared";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Card, inputClass } from "@/components/ui";
import { MissingValue } from "@/components/metric-cell";
import { getSchemes, postBasket } from "@/lib/api";

const MAX_FUNDS = 10;

type Picked = { scheme_code: string; scheme_name: string; weight: number };

export function BasketClient() {
  const [picked, setPicked] = useState<Picked[]>([]);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Scheme[]>([]);
  const [result, setResult] = useState<BasketResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (query.trim().length < 2) {
      setResults([]);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      getSchemes(`q=${encodeURIComponent(query.trim())}&limit=10`)
        .then((response) => !cancelled && setResults(response.items))
        .catch(() => !cancelled && setResults([]));
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query]);

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
    setQuery("");
  };

  const removeFund = (code: string) => setPicked((p) => p.filter((f) => f.scheme_code !== code));
  const equaliseWeights = () => setPicked((p) => p.map((f) => ({ ...f, weight: 1 })));
  const setWeight = (code: string, value: number) =>
    setPicked((p) => p.map((f) => (f.scheme_code === code ? { ...f, weight: value } : f)));

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-lg font-semibold tracking-tight">Basket analysis</h1>
        <p className="mt-1 text-sm text-ink-500">
          Pick up to {MAX_FUNDS} funds and a weight for each to see how they move together and what
          blending them does to risk and return.
        </p>
      </header>

      <div className="rounded-md border border-warn-300 bg-warn-50 p-3 text-sm text-warn-900">
        <strong>Correlation of returns is not portfolio overlap.</strong> Two funds holding entirely
        different stocks can still move together every month, and two funds holding the same stocks
        in different weights can still show up here as only loosely correlated. This basket is built
        purely from NAV history - it says nothing about what either fund actually owns.
      </div>

      <Card title="Add a fund">
        <input
          className={`${inputClass} w-full max-w-lg`}
          placeholder="Search by fund name, AMC or scheme code"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search funds to add to the basket"
        />
        {results.length ? (
          <ul className="mt-2 max-w-lg space-y-1">
            {results.map((scheme) => (
              <li key={scheme.scheme_code}>
                <button
                  className="w-full rounded px-2 py-1 text-left text-sm hover:bg-ink-100 disabled:opacity-40"
                  disabled={
                    picked.length >= MAX_FUNDS ||
                    picked.some((p) => p.scheme_code === scheme.scheme_code)
                  }
                  onClick={() => addFund(scheme)}
                >
                  {scheme.scheme_name}
                  <span className="ml-2 text-xs text-ink-500">{scheme.clean_sub_category}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </Card>

      {picked.length ? (
        <Card
          title="Basket weights"
          subtitle="Any positive numbers work - they are normalised to sum to 1 before scoring."
        >
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <tbody>
                {picked.map((fund) => (
                  <tr key={fund.scheme_code} className="border-t border-ink-100 first:border-t-0">
                    <td className="py-1.5 pr-3">
                      <Link
                        href={`/fund/${fund.scheme_code}`}
                        className="text-accent-600 hover:underline"
                      >
                        {fund.scheme_name}
                      </Link>
                    </td>
                    <td className="w-28 py-1.5 pr-3">
                      <input
                        type="number"
                        min={0}
                        step={0.05}
                        className={`${inputClass} w-24`}
                        value={fund.weight}
                        onChange={(e) => setWeight(fund.scheme_code, Number(e.target.value) || 0)}
                        aria-label={`Weight for ${fund.scheme_name}`}
                      />
                    </td>
                    <td className="w-16 py-1.5 pr-3 numeric text-ink-500">
                      {formatPercent(weightSum > 0 ? fund.weight / weightSum : 0)}
                    </td>
                    <td className="w-20 py-1.5 text-right">
                      <button
                        className="text-xs text-ink-500 hover:text-bad-700"
                        onClick={() => removeFund(fund.scheme_code)}
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button
            className="mt-2 text-xs text-accent-600 hover:underline"
            onClick={equaliseWeights}
          >
            Reset to equal weights
          </button>
        </Card>
      ) : (
        <p className="text-sm text-ink-500">
          Nothing selected yet. Search above, or pick funds from the{" "}
          <Link href="/screener" className="text-accent-600 hover:underline">
            screener
          </Link>
          .
        </p>
      )}

      {error ? <p className="text-sm text-bad-700">{error}</p> : null}
      {loading ? <p className="text-sm text-ink-500">Scoring basket...</p> : null}

      {result && result.reason ? (
        <Card title="Not enough shared history">
          <MissingValue reason={result.reason} description={result.reason_description} />
          <p className="mt-2 text-sm text-ink-500">
            These funds only share {formatCount(result.matched_months)} matched month
            {result.matched_months === 1 ? "" : "s"} of history; {result.min_observations} are
            required.
          </p>
        </Card>
      ) : null}

      {result && result.correlation_matrix && result.blended && result.components ? (
        <BasketResults result={result} picked={picked} />
      ) : null}
    </div>
  );
}

function correlationColor(rho: number): string {
  // Magnitude only, via opacity of the existing accent token - sign is read from the
  // number itself, so a colourblind or greyscale view still carries the information.
  const opacity = Math.round(Math.min(1, Math.abs(rho)) * 65);
  return `color-mix(in srgb, var(--color-accent-500) ${opacity}%, var(--color-surface))`;
}

function BasketResults({ result, picked }: { result: BasketResponse; picked: Picked[] }) {
  const blended = result.blended!;
  const components = result.components!;
  const matrix = result.correlation_matrix!;
  const codes = matrix.map((row) => row.scheme_code);
  const nameByCode = Object.fromEntries(picked.map((p) => [p.scheme_code, p.scheme_name]));

  return (
    <div className="space-y-4">
      <Card
        title="Correlation of monthly returns"
        subtitle={`Over ${formatCount(result.matched_months)} matched months shared by every fund in the basket.`}
      >
        <div className="overflow-x-auto">
          <table className="text-sm">
            <thead>
              <tr>
                <th className="px-2 py-1" />
                {codes.map((code) => (
                  <th
                    key={code}
                    className="px-2 py-1 text-center text-xs font-semibold text-ink-500"
                  >
                    {code}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {matrix.map((row) => (
                <tr key={row.scheme_code}>
                  <th className="px-2 py-1 text-left text-xs font-semibold text-ink-500">
                    {row.scheme_code}
                  </th>
                  {codes.map((col) => {
                    const rho = row.correlations[col] ?? null;
                    return (
                      <td
                        key={col}
                        className="numeric border border-ink-100 px-2 py-1 text-center"
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

      <Card title="Blended basket vs each component">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="bg-ink-50 text-left text-xs font-semibold uppercase tracking-wide text-ink-500">
                <th className="px-3 py-2">Fund</th>
                <th className="px-3 py-2">Weight</th>
                <th className="px-3 py-2">CAGR</th>
                <th className="px-3 py-2">Volatility</th>
                <th className="px-3 py-2">Sharpe</th>
                <th className="px-3 py-2">Max drawdown</th>
                <th className="px-3 py-2">Up-capture of blend</th>
                <th className="px-3 py-2">Down-capture of blend</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-t border-ink-200 font-semibold">
                <td className="px-3 py-1.5">Blended basket</td>
                <td className="px-3 py-1.5 numeric">{formatPercent(1)}</td>
                <td className="px-3 py-1.5 numeric">
                  {blended.cagr.value === null ? (
                    <MissingValue reason={blended.cagr.reason ?? undefined} />
                  ) : (
                    formatPercent(blended.cagr.value)
                  )}
                </td>
                <td className="px-3 py-1.5 numeric">
                  {blended.volatility.value === null ? (
                    <MissingValue reason={blended.volatility.reason ?? undefined} />
                  ) : (
                    formatPercent(blended.volatility.value)
                  )}
                </td>
                <td className="px-3 py-1.5 numeric">
                  {blended.sharpe.value === null ? (
                    <MissingValue reason={blended.sharpe.reason ?? undefined} />
                  ) : (
                    formatRatio(blended.sharpe.value)
                  )}
                </td>
                <td className="px-3 py-1.5 numeric">
                  {blended.max_drawdown.value === null ? (
                    <MissingValue reason={blended.max_drawdown.reason ?? undefined} />
                  ) : (
                    formatPercent(blended.max_drawdown.value)
                  )}
                </td>
                <td className="px-3 py-1.5 text-ink-300">-</td>
                <td className="px-3 py-1.5 text-ink-300">-</td>
              </tr>
              {components.map((c) => (
                <tr key={c.scheme_code} className="border-t border-ink-100">
                  <td className="px-3 py-1.5">
                    <Link
                      href={`/fund/${c.scheme_code}`}
                      className="text-accent-600 hover:underline"
                    >
                      {nameByCode[c.scheme_code] ?? c.scheme_code}
                    </Link>
                  </td>
                  <td className="px-3 py-1.5 numeric">{formatPercent(c.weight)}</td>
                  <td className="px-3 py-1.5 numeric">
                    {c.cagr.value === null ? (
                      <MissingValue reason={c.cagr.reason ?? undefined} />
                    ) : (
                      formatPercent(c.cagr.value)
                    )}
                  </td>
                  <td className="px-3 py-1.5 numeric">
                    {c.volatility.value === null ? (
                      <MissingValue reason={c.volatility.reason ?? undefined} />
                    ) : (
                      formatPercent(c.volatility.value)
                    )}
                  </td>
                  <td className="px-3 py-1.5 numeric">
                    {c.sharpe.value === null ? (
                      <MissingValue reason={c.sharpe.reason ?? undefined} />
                    ) : (
                      formatRatio(c.sharpe.value)
                    )}
                  </td>
                  <td className="px-3 py-1.5 numeric">
                    {c.max_drawdown.value === null ? (
                      <MissingValue reason={c.max_drawdown.reason ?? undefined} />
                    ) : (
                      formatPercent(c.max_drawdown.value)
                    )}
                  </td>
                  <td className="px-3 py-1.5 numeric">
                    {c.capture_vs_blended.up.value === null ? (
                      <MissingValue reason={c.capture_vs_blended.up.reason ?? undefined} />
                    ) : (
                      formatRatio(c.capture_vs_blended.up.value)
                    )}
                  </td>
                  <td className="px-3 py-1.5 numeric">
                    {c.capture_vs_blended.down.value === null ? (
                      <MissingValue reason={c.capture_vs_blended.down.reason ?? undefined} />
                    ) : (
                      formatRatio(c.capture_vs_blended.down.value)
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-sm text-ink-500">
          Diversification benefit:{" "}
          {result.diversification_benefit!.value === null ? (
            <MissingValue reason={result.diversification_benefit!.reason ?? undefined} />
          ) : (
            <span className="numeric font-semibold text-ink-900">
              {formatPercent(result.diversification_benefit!.value)}
            </span>
          )}{" "}
          - the weighted average of each fund&apos;s own volatility, minus the blend&apos;s
          volatility. Zero means the funds moved in lockstep; positive means blending them actually
          reduced risk.
        </p>
      </Card>
    </div>
  );
}
