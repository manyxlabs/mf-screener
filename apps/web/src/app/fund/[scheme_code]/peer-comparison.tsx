"use client";

import {
  formatPercent,
  formatPercentagePoints,
  formatRatio,
  type ComparisonResponse,
} from "@mf/shared";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Card, inputClass } from "@/components/ui";
import { getComparison } from "@/lib/api";

type Toggles = {
  level: "sub_category" | "category";
  plan_scope: "direct" | "direct_regular" | "all";
  option_scope: "growth" | "all";
  active_only: boolean;
  aggregation: "mean" | "median";
  exclude_self: boolean;
};

const DEFAULTS: Toggles = {
  level: "sub_category",
  plan_scope: "direct",
  option_scope: "growth",
  active_only: true,
  aggregation: "mean",
  exclude_self: true,
};

export function PeerComparison({ schemeCode }: { schemeCode: string }) {
  const [toggles, setToggles] = useState<Toggles>(DEFAULTS);
  const [data, setData] = useState<ComparisonResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const query = useMemo(
    () => new URLSearchParams(Object.entries(toggles).map(([k, v]) => [k, String(v)])).toString(),
    [toggles],
  );

  useEffect(() => {
    let cancelled = false;
    getComparison(schemeCode, query)
      .then((response) => !cancelled && setData(response))
      .catch((err: Error) => !cancelled && setError(err.message));
    return () => {
      cancelled = true;
    };
  }, [schemeCode, query]);

  const set = <K extends keyof Toggles>(key: K, value: Toggles[K]) =>
    setToggles((t) => ({ ...t, [key]: value }));

  return (
    <Card
      title="Peer comparison"
      subtitle="Recomputed live for the methodology you choose here, not read from the stored snapshot."
    >
      <div className="mb-4 flex flex-wrap gap-4 text-sm">
        <label className="flex items-center gap-2">
          Compare against
          <select
            className={inputClass}
            value={toggles.level}
            onChange={(e) => set("level", e.target.value as Toggles["level"])}
          >
            <option value="sub_category">sub-category</option>
            <option value="category">category</option>
          </select>
        </label>
        <label className="flex items-center gap-2">
          Plans
          <select
            className={inputClass}
            value={toggles.plan_scope}
            onChange={(e) => set("plan_scope", e.target.value as Toggles["plan_scope"])}
          >
            <option value="direct">Direct only</option>
            <option value="direct_regular">Direct + Regular</option>
            <option value="all">All plans</option>
          </select>
        </label>
        <label className="flex items-center gap-2">
          Options
          <select
            className={inputClass}
            value={toggles.option_scope}
            onChange={(e) => set("option_scope", e.target.value as Toggles["option_scope"])}
          >
            <option value="growth">Growth only</option>
            <option value="all">All options</option>
          </select>
        </label>
        <label className="flex items-center gap-2">
          Peer average
          <select
            className={inputClass}
            value={toggles.aggregation}
            onChange={(e) => set("aggregation", e.target.value as Toggles["aggregation"])}
          >
            <option value="mean">equal-weighted mean</option>
            <option value="median">median</option>
          </select>
        </label>
        <label className="flex items-center gap-1.5">
          <input
            type="checkbox"
            checked={toggles.exclude_self}
            onChange={(e) => set("exclude_self", e.target.checked)}
          />
          Leave the fund out of its own peer average
        </label>
        <label className="flex items-center gap-1.5">
          <input
            type="checkbox"
            checked={toggles.active_only}
            onChange={(e) => set("active_only", e.target.checked)}
          />
          Active peers only
        </label>
      </div>

      {toggles.plan_scope !== "direct" || toggles.option_scope !== "growth" ? (
        <p className="mb-3 rounded bg-warn-50 p-2 text-xs text-warn-900">
          You are comparing across plans or options. Regular plans carry distributor commission and
          IDCW options pay out of NAV, so these peers are not measuring the same thing.
        </p>
      ) : null}

      {error ? <p className="text-sm text-bad-700">{error}</p> : null}
      {data ? (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-ink-500">
                <tr>
                  <th className="py-1">Horizon</th>
                  <th>Fund</th>
                  <th>Peers</th>
                  <th>Excess</th>
                  <th>Ratio</th>
                  <th>Peer count</th>
                </tr>
              </thead>
              <tbody>
                {["1y", "3y", "5y", "10y"].map((h) => {
                  const row = data.horizons[h];
                  if (!row) return null;
                  return (
                    <tr key={h} className="border-t border-ink-100">
                      <td className="py-1.5 font-medium">{h.toUpperCase()}</td>
                      <td className="numeric">{formatPercent(row.fund_cagr)}</td>
                      <td className="numeric">{formatPercent(row.category_return)}</td>
                      <td className="numeric">{formatPercentagePoints(row.excess)}</td>
                      <td className="numeric" title={row.ratio_reason ?? undefined}>
                        {formatRatio(row.ratio)}
                      </td>
                      <td className="numeric text-ink-500">n={row.peer_count}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <h3 className="mt-4 text-xs font-semibold uppercase tracking-wide text-ink-500">
            Peer universe ({data.peer_universe_size} schemes in {data.label})
          </h3>
          <ul className="mt-2 grid gap-1 text-sm md:grid-cols-2">
            {data.peers.map((peer) => (
              <li key={peer.scheme_code}>
                <Link
                  href={`/fund/${peer.scheme_code}`}
                  className="text-accent-600 hover:underline"
                >
                  {peer.scheme_name}
                </Link>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="text-sm text-ink-500">Loading peer comparison...</p>
      )}
    </Card>
  );
}
