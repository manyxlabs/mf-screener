"use client";

import type { OverlapResponse, Scheme } from "@mf/shared";
import { formatPercent } from "@mf/shared";
import Link from "next/link";
import { useEffect, useState } from "react";
import { MissingValue } from "@/components/metric-cell";
import { Badge, Button, Card, inputClass } from "@/components/ui";
import { getOverlap, getSchemes } from "@/lib/api";

const MIN_FUNDS = 2;
const MAX_FUNDS = 5;

type Picked = { scheme_code: string; scheme_name: string };

/**
 * How much of two funds' money is in the same instruments.
 *
 * Unlike every other page here, this one reads a file someone imported rather than
 * anything computed from NAV, and this project ships no holdings data. An empty state
 * is therefore the normal first experience, and it has to say so rather than look broken.
 */
export function OverlapClient() {
  const [picked, setPicked] = useState<Picked[]>([]);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Scheme[]>([]);
  const [data, setData] = useState<OverlapResponse | null>(null);
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
        .then((r) => !cancelled && setResults(r.items))
        .catch(() => !cancelled && setResults([]));
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query]);

  const codes = picked.map((p) => p.scheme_code).join(",");
  useEffect(() => {
    const list = codes ? codes.split(",") : [];
    if (list.length < MIN_FUNDS) {
      setData(null);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    getOverlap(list)
      .then((r) => {
        if (cancelled) return;
        setData(r);
        setError(null);
      })
      .catch((err: Error) => {
        if (cancelled) return;
        setError(err.message);
        setData(null);
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [codes]);

  const nameOf = (code: string) => picked.find((p) => p.scheme_code === code)?.scheme_name ?? code;

  return (
    <div className="space-y-4">
      <header className="max-w-3xl space-y-2">
        <h1 className="text-xl font-semibold text-ink-900">Portfolio overlap</h1>
        <p className="text-sm text-ink-700">
          How much of two funds&rsquo; money sits in the same instruments. Two funds you hold for
          diversification can turn out to be largely the same portfolio.
        </p>
        <p className="text-xs text-ink-500">
          Overlap is the sum of the smaller weight in each shared holding, so two identical
          portfolios are 100% and two with nothing in common are 0%. Holdings are a month-old
          photograph: the fund can have traded since. This is a different measurement from the{" "}
          <Link className="underline" href="/basket">
            return correlation on the basket page
          </Link>
          , and two funds holding different stocks can still move together.
        </p>
      </header>

      <Card title={`Pick ${MIN_FUNDS} to ${MAX_FUNDS} funds`} subtitle="Type a fund name or AMC.">
        <input
          className={`${inputClass} w-full max-w-lg`}
          placeholder="Search funds"
          aria-label="Search funds"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {results.length ? (
          <ul className="mt-2 max-h-56 max-w-lg overflow-y-auto rounded-md border border-ink-200">
            {results.map((s) => (
              <li key={s.scheme_code}>
                <button
                  type="button"
                  className="w-full px-3 py-2 text-left text-sm hover:bg-ink-100 disabled:opacity-40"
                  disabled={
                    picked.length >= MAX_FUNDS ||
                    picked.some((p) => p.scheme_code === s.scheme_code)
                  }
                  onClick={() => {
                    setPicked((p) => [
                      ...p,
                      { scheme_code: s.scheme_code, scheme_name: s.scheme_name },
                    ]);
                    setQuery("");
                    setResults([]);
                  }}
                >
                  {s.scheme_name}
                </button>
              </li>
            ))}
          </ul>
        ) : null}

        {picked.length ? (
          <ul className="mt-3 space-y-1">
            {picked.map((p) => (
              <li key={p.scheme_code} className="flex items-center gap-2 text-sm">
                <span className="flex-1">{p.scheme_name}</span>
                <Button
                  variant="ghost"
                  onClick={() =>
                    setPicked((list) => list.filter((x) => x.scheme_code !== p.scheme_code))
                  }
                >
                  Remove
                </Button>
              </li>
            ))}
          </ul>
        ) : null}
        {picked.length === 1 ? (
          <p className="mt-2 text-xs text-ink-500">Pick one more to compare.</p>
        ) : null}
      </Card>

      {error ? (
        <Card title="Could not compare these funds">
          <p className="text-sm text-bad-800">{error}</p>
        </Card>
      ) : null}

      {loading ? <p className="text-sm text-ink-500">Loading…</p> : null}

      {data ? (
        <>
          <Card title="What is loaded for each fund">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase tracking-wide text-ink-500">
                  <tr>
                    <th className="py-1">Fund</th>
                    <th>Portfolio as of</th>
                    <th>Holdings</th>
                  </tr>
                </thead>
                <tbody>
                  {data.funds.map((f) => (
                    <tr key={f.scheme_code} className="border-t border-ink-100">
                      <td className="py-1.5 pr-3">{f.scheme_name}</td>
                      <td className="pr-3">
                        {f.as_of_month ?? (
                          <MissingValue
                            reason={f.reason ?? undefined}
                            description={f.reason_description ?? undefined}
                          />
                        )}
                        {f.stale ? (
                          <span className="ml-1.5">
                            <Badge tone="warn">stale</Badge>
                          </span>
                        ) : null}
                      </td>
                      <td className="numeric">{f.holdings_count || "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {data.funds.every((f) => f.holdings_count === 0) ? (
              <p className="mt-3 rounded border border-ink-200 bg-ink-50 px-3 py-2 text-xs text-ink-700">
                No holdings are loaded for these funds. This project ships no holdings data: AMFI
                publishes none, and the one free third-party source was unreachable on every probe.
                Import your own with{" "}
                <code className="rounded bg-ink-100 px-1">make holdings-import FILE=...</code> - the
                CSV contract is in the README, and nothing is written unless the whole file passes.
              </p>
            ) : null}
          </Card>

          <Card
            title="Overlap"
            subtitle="The sum of the smaller weight in each instrument both funds hold."
          >
            {data.pairs.length === 0 ? (
              <p className="text-sm text-ink-500">Nothing to compare yet.</p>
            ) : (
              <div className="space-y-4">
                {data.pairs.map((pair) => {
                  const key = `${pair.scheme_code_a}-${pair.scheme_code_b}`;
                  return (
                    <section key={key} className="rounded-md border border-ink-200 p-3">
                      <header className="flex flex-wrap items-baseline gap-2">
                        <h3 className="text-sm font-medium text-ink-900">
                          {nameOf(pair.scheme_code_a)} vs {nameOf(pair.scheme_code_b)}
                        </h3>
                        <span className="numeric text-lg font-semibold">
                          {pair.overlap_pct === null ? (
                            <MissingValue
                              reason={pair.reason ?? undefined}
                              description={pair.reason_description ?? undefined}
                            />
                          ) : (
                            formatPercent(pair.overlap_pct / 100)
                          )}
                        </span>
                        {pair.as_of_a && pair.as_of_b ? (
                          <span className="text-[11px] text-ink-500">
                            {pair.as_of_a} vs {pair.as_of_b}
                          </span>
                        ) : null}
                      </header>
                      {pair.shared_instruments.length ? (
                        <div className="overflow-x-auto">
                          <table className="mt-2 w-full text-sm">
                            <thead className="text-left text-xs uppercase tracking-wide text-ink-500">
                              <tr>
                                <th className="py-1">Shared holding</th>
                                <th className="text-right">In first</th>
                                <th className="text-right">In second</th>
                                <th className="text-right">Counted</th>
                              </tr>
                            </thead>
                            <tbody>
                              {pair.shared_instruments.slice(0, 25).map((i) => (
                                <tr key={i.instrument_key} className="border-t border-ink-100">
                                  <td className="py-1">{i.instrument_name}</td>
                                  <td className="numeric text-right">
                                    {formatPercent(i.weight_a)}
                                  </td>
                                  <td className="numeric text-right">
                                    {formatPercent(i.weight_b)}
                                  </td>
                                  <td className="numeric text-right">
                                    {formatPercent(i.min_weight)}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      ) : null}
                      {pair.shared_instruments.length > 25 ? (
                        <p className="mt-1 text-[11px] text-ink-500">
                          Showing the 25 largest of {pair.shared_instruments.length} shared
                          holdings.
                        </p>
                      ) : null}
                    </section>
                  );
                })}
              </div>
            )}
          </Card>

          <p className="text-xs text-ink-500">{data.caveat}</p>
        </>
      ) : null}
    </div>
  );
}
