import {
  formatDuration,
  formatPercent,
  pluralise,
  type Behaviour,
  type Exposure,
} from "@mf/shared";
import { StyleDriftChart } from "@/components/charts";
import { Card } from "@/components/ui";
import type { RollingExposure } from "@/lib/api";

const MISSING_DASH = "-";

/** The falls a holder actually lived through, and how long each took to come back. */
export function DrawdownHistory({ behaviour }: { behaviour: Behaviour }) {
  return (
    <Card
      title="Falls and recoveries"
      subtitle={`Every distinct fall of ${formatPercent(behaviour.min_drawdown_depth, 0)} or more from a daily-NAV high, worst first. An episode ends when the old high is regained, so 2020 and 2022 are counted separately.`}
    >
      {behaviour.drawdowns.length === 0 ? (
        <p className="py-6 text-center text-sm text-ink-500">
          No fall of {formatPercent(behaviour.min_drawdown_depth, 0)} or more in the NAV history
          held for this scheme. For a fund launched after the last correction that says more about
          its age than about its resilience.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[34rem] text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-ink-500">
              <tr>
                <th className="py-1.5">Fall</th>
                <th>From</th>
                <th>To</th>
                <th>Time down</th>
                <th>Back to even</th>
              </tr>
            </thead>
            <tbody>
              {behaviour.drawdowns.map((episode) => (
                <tr key={episode.peak_date} className="border-t border-ink-100">
                  <td className="py-1.5 numeric font-medium text-bad-700">
                    {formatPercent(episode.depth)}
                  </td>
                  <td className="numeric text-ink-700">{episode.peak_date}</td>
                  <td className="numeric text-ink-700">{episode.trough_date}</td>
                  <td className="numeric text-ink-700">{formatDuration(episode.days_to_trough)}</td>
                  <td className="numeric">
                    {episode.days_to_recover === null ? (
                      <span className="text-bad-700">still below this peak</span>
                    ) : (
                      <span className="text-ink-700">
                        {formatDuration(episode.days_to_recover)}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <CapturePair behaviour={behaviour} />
    </Card>
  );
}

function CapturePair({ behaviour }: { behaviour: Behaviour }) {
  const { up, down, reason, horizon_years: horizon } = behaviour.capture;
  if (up === null && down === null) {
    return (
      <p className="mt-3 border-t border-ink-100 pt-3 text-xs text-ink-500">
        Up and down capture need at least 24 months shared with the peer group over the trailing{" "}
        {horizon} years. {reason ? <span className="font-mono">{reason}</span> : null}
      </p>
    );
  }
  return (
    <div className="mt-3 grid gap-3 border-t border-ink-100 pt-3 sm:grid-cols-2">
      <CaptureStat
        label="Up capture"
        value={up}
        hint="Share of the peer group's gain taken when peers rose. Above 1 is more."
      />
      <CaptureStat
        label="Down capture"
        value={down}
        hint="Share of the peer group's loss taken when peers fell. Below 1 is less, and better."
      />
      <p className="text-[11px] text-ink-500 sm:col-span-2">
        Over the trailing {horizon} years, against the equal-weighted return of this fund&apos;s
        sub-category with the fund itself left out. Not a benchmark index: capture against peers and
        capture against an index are different numbers. This is the same figure the screener sorts
        on.
      </p>
    </div>
  );
}

function CaptureStat({
  label,
  value,
  hint,
}: {
  label: string;
  value: number | null;
  hint: string;
}) {
  return (
    <div className="rounded-md border border-ink-200 px-3 py-2">
      <div className="text-[11px] uppercase tracking-wide text-ink-500">{label}</div>
      <div className="mt-0.5 text-lg font-semibold numeric">
        {value === null ? MISSING_DASH : value.toFixed(2)}
      </div>
      <div className="mt-0.5 text-[11px] text-ink-500">{hint}</div>
    </div>
  );
}

/** Year by year against the peer group, so one exceptional year cannot hide behind a CAGR. */
export function CalendarYears({ behaviour }: { behaviour: Behaviour }) {
  const years = [...behaviour.calendar_years].reverse();
  const beaten = years.filter(
    (y) => y.category_return !== null && y.fund_return > y.category_return,
  ).length;
  const comparable = years.filter((y) => y.category_return !== null).length;
  return (
    <Card
      title="Calendar year returns"
      subtitle={
        comparable > 0
          ? `Beat its sub-category in ${beaten} of ${comparable} calendar years. A trailing CAGR averages these away; this is the run of years it averaged.`
          : "No peer comparison is available for these years."
      }
    >
      <div className="overflow-x-auto">
        <table className="w-full min-w-[30rem] text-sm">
          <thead className="text-left text-xs uppercase tracking-wide text-ink-500">
            <tr>
              <th className="py-1.5">Year</th>
              <th>Fund</th>
              <th>Sub-category</th>
              <th>Difference</th>
            </tr>
          </thead>
          <tbody>
            {years.map((year) => {
              const diff =
                year.category_return === null ? null : year.fund_return - year.category_return;
              return (
                <tr key={year.year} className="border-t border-ink-100">
                  <td className="py-1.5 numeric text-ink-700">
                    {year.year}
                    {year.months < 12 ? (
                      <span className="ml-1 text-[11px] text-ink-500">
                        ({year.months} mo, partial)
                      </span>
                    ) : null}
                  </td>
                  <td
                    className={`numeric ${year.fund_return < 0 ? "text-bad-700" : "text-ink-900"}`}
                  >
                    {formatPercent(year.fund_return)}
                  </td>
                  <td className="numeric text-ink-500">
                    {year.category_return === null
                      ? MISSING_DASH
                      : formatPercent(year.category_return)}
                  </td>
                  <td
                    className={`numeric ${diff === null ? "" : diff >= 0 ? "text-good-700" : "text-bad-700"}`}
                  >
                    {diff === null ? MISSING_DASH : formatPercent(diff)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

/** What the fee costs against the median peer, with the arithmetic shown. */
export function CostPanel({ behaviour }: { behaviour: Behaviour }) {
  const { expense_ratio, category_median, category_count, horizon_years, shortfall_vs_median } =
    behaviour.cost;
  return (
    <Card
      title="Cost against its peers"
      subtitle="Returns on this page are already net of the expense ratio, so this is not a second deduction. It is what the fee difference compounds to."
    >
      {expense_ratio === null || category_median === null ? (
        <p className="text-sm text-ink-500">
          {expense_ratio === null
            ? "No expense ratio published for this scheme, so no comparison is possible. AMFI's TER disclosure carries no scheme code, so it is matched by name, and a value is never inferred from a similar fund."
            : `Only ${pluralise(category_count, "peer")} in this sub-category publish an expense ratio, which is too few for a median.`}
        </p>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <Figure label="This fund" value={formatPercent(expense_ratio, 2)} />
            <Figure
              label={`Sub-category median (${pluralise(category_count, "fund")})`}
              value={formatPercent(category_median, 2)}
            />
            <Figure
              label={`Fee gap over ${horizon_years} years`}
              value={
                shortfall_vs_median === null ? MISSING_DASH : formatPercent(shortfall_vs_median, 2)
              }
              tone={
                shortfall_vs_median === null ? "flat" : shortfall_vs_median >= 0 ? "good" : "bad"
              }
            />
          </div>
          <p className="mt-3 text-xs text-ink-500">
            {shortfall_vs_median === null
              ? null
              : shortfall_vs_median >= 0
                ? `Cheaper than the median peer. Holding it for ${horizon_years} years leaves ${formatPercent(shortfall_vs_median, 2)} more in the fund than the median would, before any difference in what the manager returns.`
                : `Dearer than the median peer. Holding it for ${horizon_years} years leaves ${formatPercent(Math.abs(shortfall_vs_median), 2)} less in the fund than the median would, which the manager has to earn back before you are level.`}
          </p>
        </>
      )}
    </Card>
  );
}

function Figure({
  label,
  value,
  tone = "flat",
}: {
  label: string;
  value: string;
  tone?: "good" | "bad" | "flat";
}) {
  const toneClass =
    tone === "good" ? "text-good-700" : tone === "bad" ? "text-bad-700" : "text-ink-900";
  return (
    <div className="rounded-md border border-ink-200 px-3 py-2">
      <div className="flex min-h-[2.4em] text-[11px] uppercase tracking-wide text-ink-500">
        {label}
      </div>
      <div className={`mt-0.5 text-lg font-semibold numeric ${toneClass}`}>{value}</div>
    </div>
  );
}

/**
 * What the fund behaves like, when nobody publishes what it holds. The bars are a fitted
 * mix of index returns, so the panel has to keep saying that they are not positions.
 */
export function ExposurePanel({ exposure }: { exposure: Exposure }) {
  const fit = exposure.r_squared;
  return (
    <Card
      title="Estimated exposure"
      subtitle="AMFI publishes no portfolio for any Indian fund, so this is inferred from how the NAV moved, not read from holdings. It is the long-only mix of index returns that best explains this fund's monthly returns."
    >
      {exposure.weights.length === 0 ? (
        <div className="rounded-md border border-warn-300 bg-warn-50 p-3 text-sm text-warn-900">
          <strong>No exposure can be estimated for this fund.</strong>{" "}
          {exposure.reason === "style_basis_does_not_describe_this_fund"
            ? `The Indian equity indices in the basis explain too little of its movement${
                fit === null ? "" : ` (R-squared ${fit.toFixed(2)})`
              } for any weighting to mean something. That is the expected answer for a fund investing outside India, or in gold or debt.`
            : `Fitting needs at least 24 months shared with every index in the basis; this fund has ${exposure.months}.`}
        </div>
      ) : (
        <>
          <ul className="space-y-1.5">
            {exposure.weights.map((row) => (
              <li key={row.benchmark_id} className="flex items-center gap-3">
                <span className="w-44 shrink-0 text-sm text-ink-700">{row.benchmark_name}</span>
                <span className="h-2.5 flex-1 overflow-hidden rounded-full bg-ink-100">
                  <span
                    className="block h-full rounded-full bg-accent-500"
                    style={{ width: `${Math.min(row.weight * 100, 100)}%` }}
                  />
                </span>
                <span className="w-14 shrink-0 text-right text-sm numeric">
                  {formatPercent(row.weight, 1)}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-ink-500">
            Fitted over {exposure.months} months, {exposure.first_date} to {exposure.last_date}.
            {fit === null
              ? null
              : ` The mix explains ${formatPercent(fit, 0)} of this fund's month-to-month movement.`}
          </p>
        </>
      )}
      <p className="mt-2 border-t border-ink-100 pt-2 text-[11px] text-ink-500">
        {exposure.caveat}
      </p>
    </Card>
  );
}

/**
 * The same fit as ExposurePanel, refit on every trailing 36-month window instead of
 * once, so a fund that changed what it behaves like shows the change rather than an
 * average of both regimes.
 */
export function StyleDriftPanel({ rolling }: { rolling: RollingExposure }) {
  const fitted = rolling.points.filter((p) => p.weights !== null);
  const omitted = rolling.points.length - fitted.length;
  const drift = rolling.style_drift_3y;
  return (
    <Card
      title="Style drift"
      subtitle="Inferred from NAV, not a holdings statement: each band is the fitted mix of the same style-factor basis as above, refit on a rolling 36-month window and stepped one month at a time."
    >
      <StyleDriftChart
        points={fitted.map((p) => ({
          end_date: p.end_date ?? "",
          weights: (p.weights ?? []).map((w) => ({
            benchmark_name: w.benchmark_name,
            weight: w.weight,
          })),
        }))}
      />
      <dl className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-3">
        <div className="rounded border border-ink-200 px-2 py-1.5">
          <dt className="text-ink-500">Style drift (3Y)</dt>
          <dd className="numeric">
            {drift.value === null ? MISSING_DASH : formatPercent(drift.value, 1)}
          </dd>
        </div>
        <div className="rounded border border-ink-200 px-2 py-1.5">
          <dt className="text-ink-500">Fitted windows</dt>
          <dd className="numeric">{fitted.length}</dd>
        </div>
        <div className="rounded border border-ink-200 px-2 py-1.5">
          <dt className="text-ink-500">Omitted (weak fit)</dt>
          <dd className="numeric">{omitted}</dd>
        </div>
      </dl>
      {drift.value === null ? (
        <p className="mt-2 text-xs text-ink-500">
          {drift.reason === "insufficient_rolling_windows"
            ? "Fewer than 2 windows in the last 3 years cleared the R-squared floor, so no single drift figure is reported."
            : "Not enough shared history with the basis to fit even one 36-month window."}
        </p>
      ) : null}
      <p className="mt-2 border-t border-ink-100 pt-2 text-[11px] text-ink-500">{rolling.caveat}</p>
    </Card>
  );
}
