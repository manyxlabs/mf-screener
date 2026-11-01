import {
  formatPercent,
  formatPercentagePoints,
  formatRatio,
  type ComparisonResponse,
} from "@mf/shared";
import Link from "next/link";
import { Card } from "@/components/ui";

/** Only the default peer group is published; a string is the API's refusal of it. */
export function PeerComparison({ comparison }: { comparison: ComparisonResponse | string }) {
  const [data, error] = typeof comparison === "string" ? [null, comparison] : [comparison, null];
  return (
    <Card
      title="Peer comparison"
      subtitle="Against the mean of active Direct Growth peers in the fund's peer group, with the fund itself left out."
    >
      <p className="mb-3 text-xs text-ink-500">
        Other peer groups (whole category, Regular plans, IDCW options, median) are recomputed live
        and need the local app.
      </p>
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
      ) : null}
    </Card>
  );
}
