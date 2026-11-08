import {
  formatPercent,
  formatPercentagePoints,
  formatRatio,
  type ComparisonResponse,
} from "@mf/shared";
import Link from "@/components/link";
import { Card } from "@/components/ui";
import { useI18n } from "@/lib/i18n/client";

/** Only the default peer group is published; a string is the API's refusal of it. */
export function PeerComparison({ comparison }: { comparison: ComparisonResponse | string }) {
  const { t, td, number } = useI18n();
  const words = t.fund.peers;
  const [data, error] = typeof comparison === "string" ? [null, comparison] : [comparison, null];
  return (
    <Card title={words.title} subtitle={words.subtitle}>
      <p className="mb-3 text-xs text-ink-500">
        {words.otherGroups}
        <code>make api</code>
        {words.otherGroupsAfter}
      </p>
      {error ? <p className="text-sm text-bad-700">{td(error)}</p> : null}
      {data ? (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-ink-500">
                <tr>
                  <th className="py-1">{t.fund.returns.horizon}</th>
                  <th>{t.charts.fund}</th>
                  <th>{t.fund.returns.peers}</th>
                  <th>{words.excess}</th>
                  <th>{t.fund.returns.ratio}</th>
                  <th>{words.peerCount}</th>
                </tr>
              </thead>
              <tbody>
                {[1, 3, 5, 10].map((h) => {
                  const row = data.horizons[`${h}y`];
                  if (!row) return null;
                  return (
                    <tr key={h} className="border-t border-ink-100">
                      <td className="py-1.5 font-medium">{t.fund.horizon(h)}</td>
                      <td className="numeric">{formatPercent(row.fund_cagr)}</td>
                      <td className="numeric">{formatPercent(row.category_return)}</td>
                      <td className="numeric">{formatPercentagePoints(row.excess, 2, t.units)}</td>
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
            {words.universe(number(data.peer_universe_size), data.label)}
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
