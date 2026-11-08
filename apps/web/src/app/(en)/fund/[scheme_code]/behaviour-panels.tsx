import { formatDuration, formatPercent, type Behaviour, type Exposure } from "@mf/shared";
import { StyleDriftChart } from "@/components/charts";
import { Card } from "@/components/ui";
import type { RollingExposure } from "@/lib/api";
import { useI18n } from "@/lib/i18n/client";

const MISSING_DASH = "-";

/** The falls a holder actually lived through, and how long each took to come back. */
export function DrawdownHistory({ behaviour }: { behaviour: Behaviour }) {
  const { t } = useI18n();
  const words = t.fund.drawdowns;
  const depth = formatPercent(behaviour.min_drawdown_depth, 0);
  return (
    <Card title={words.title} subtitle={words.subtitle(depth)}>
      {behaviour.drawdowns.length === 0 ? (
        <p className="py-6 text-center text-sm text-ink-500">{words.none(depth)}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[34rem] text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-ink-500">
              <tr>
                <th className="py-1.5">{words.fall}</th>
                <th>{words.from}</th>
                <th>{words.to}</th>
                <th>{words.timeDown}</th>
                <th>{words.backToEven}</th>
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
                  <td className="numeric text-ink-700">
                    {formatDuration(episode.days_to_trough, t.units)}
                  </td>
                  <td className="numeric">
                    {episode.days_to_recover === null ? (
                      <span className="text-bad-700">{words.stillBelow}</span>
                    ) : (
                      <span className="text-ink-700">
                        {formatDuration(episode.days_to_recover, t.units)}
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
  const { t } = useI18n();
  const { up, down, reason, horizon_years: horizon } = behaviour.capture;
  if (up === null && down === null) {
    return (
      <p className="mt-3 border-t border-ink-100 pt-3 text-xs text-ink-500">
        {t.fund.capture.insufficient(horizon)}{" "}
        {reason ? <span className="font-mono">{reason}</span> : null}
      </p>
    );
  }
  return (
    <div className="mt-3 grid gap-3 border-t border-ink-100 pt-3 sm:grid-cols-2">
      <CaptureStat
        label={t.compare.derived.up_capture.label}
        value={up}
        hint={t.fund.capture.upHint}
      />
      <CaptureStat
        label={t.compare.derived.down_capture.label}
        value={down}
        hint={t.fund.capture.downHint}
      />
      <p className="text-[11px] text-ink-500 sm:col-span-2">{t.fund.capture.basis(horizon)}</p>
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
    <div className="rounded-xl border border-ink-200 px-3 py-2">
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
  const { t } = useI18n();
  const words = t.fund.calendar;
  const years = [...behaviour.calendar_years].reverse();
  const beaten = years.filter(
    (y) => y.category_return !== null && y.fund_return > y.category_return,
  ).length;
  const comparable = years.filter((y) => y.category_return !== null).length;
  return (
    <Card
      title={words.title}
      subtitle={comparable > 0 ? words.beaten(beaten, comparable) : words.noPeers}
    >
      <div className="overflow-x-auto">
        <table className="w-full min-w-[30rem] text-sm">
          <thead className="text-left text-xs uppercase tracking-wide text-ink-500">
            <tr>
              <th className="py-1.5">{words.year}</th>
              <th>{t.charts.fund}</th>
              <th>{words.subCategory}</th>
              <th>{words.difference}</th>
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
                        {words.partial(year.months)}
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
  const { t } = useI18n();
  const words = t.fund.cost;
  return (
    <Card title={words.title} subtitle={words.subtitle}>
      {expense_ratio === null || category_median === null ? (
        <p className="text-sm text-ink-500">
          {expense_ratio === null ? words.noTer : words.tooFew(category_count)}
        </p>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <Figure label={words.thisFund} value={formatPercent(expense_ratio, 2)} />
            <Figure
              label={words.median(category_count)}
              value={formatPercent(category_median, 2)}
            />
            <Figure
              label={words.feeGap(horizon_years)}
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
                ? words.cheaper(horizon_years, formatPercent(shortfall_vs_median, 2))
                : words.dearer(horizon_years, formatPercent(Math.abs(shortfall_vs_median), 2))}
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
    <div className="rounded-xl border border-ink-200 px-3 py-2">
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
  const { t, td } = useI18n();
  const words = t.fund.exposure;
  const fit = exposure.r_squared;
  return (
    <Card title={words.title} subtitle={words.subtitle}>
      {exposure.weights.length === 0 ? (
        <div className="rounded-xl border border-warn-300 bg-warn-50 p-3 text-sm text-warn-900">
          <strong>{words.none}</strong>{" "}
          {exposure.reason === "style_basis_does_not_describe_this_fund"
            ? words.basisMismatch(fit === null ? null : fit.toFixed(2))
            : words.tooShort(exposure.months)}
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
            {words.fitted(exposure.months, exposure.first_date ?? "-", exposure.last_date ?? "-")}
            {fit === null ? null : ` ${words.explains(formatPercent(fit, 0))}`}
          </p>
        </>
      )}
      <p className="mt-2 border-t border-ink-100 pt-2 text-[11px] text-ink-500">
        {td(exposure.caveat)}
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
  const { t, td } = useI18n();
  const words = t.fund.drift;
  return (
    <Card title={words.title} subtitle={words.subtitle}>
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
          <dt className="text-ink-500">{words.drift3y}</dt>
          <dd className="numeric">
            {drift.value === null ? MISSING_DASH : formatPercent(drift.value, 1)}
          </dd>
        </div>
        <div className="rounded border border-ink-200 px-2 py-1.5">
          <dt className="text-ink-500">{words.fittedWindows}</dt>
          <dd className="numeric">{fitted.length}</dd>
        </div>
        <div className="rounded border border-ink-200 px-2 py-1.5">
          <dt className="text-ink-500">{words.omitted}</dt>
          <dd className="numeric">{omitted}</dd>
        </div>
      </dl>
      {drift.value === null ? (
        <p className="mt-2 text-xs text-ink-500">
          {drift.reason === "insufficient_rolling_windows" ? words.fewWindows : words.noHistory}
        </p>
      ) : null}
      <p className="mt-2 border-t border-ink-100 pt-2 text-[11px] text-ink-500">
        {td(rolling.caveat)}
      </p>
    </Card>
  );
}
