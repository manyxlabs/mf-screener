"use client";

import { formatPercent } from "@mf/shared";
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import Link from "@/components/link";
import { MissingValue } from "@/components/metric-cell";
import { InfoTooltip } from "@/components/tooltip";
import { Badge, Button, Card, Field, inputClass, Stat } from "@/components/ui";
import { getSchemeExposure } from "@/lib/api";
import { CasFormatError, CasPasswordError, parseCas } from "@/lib/cas/parse";
import type { CasStatement } from "@/lib/cas/types";
import { useI18n } from "@/lib/i18n/client";
import {
  checkup,
  loadFundData,
  styleOverlaps,
  type Checkup,
  type Figure,
  type Holding,
  type Slice,
  type StylePair,
} from "@/lib/portfolio";

type State =
  | { status: "idle" | "reading" }
  | { status: "error"; message: string; password: boolean }
  | { status: "done"; statement: CasStatement; result: Checkup };

function useFormat() {
  const { number } = useI18n();
  const rupees = (v: number) => `${v < 0 ? "-" : ""}₹${number(Math.abs(Math.round(v)))}`;
  return {
    number,
    rupees,
    signedRupees: (v: number) => `${v > 0 ? "+" : ""}${rupees(v)}`,
    units: (v: number) => number(v, { minimumFractionDigits: 3, maximumFractionDigits: 3 }),
  };
}

export function PortfolioClient() {
  const { t } = useI18n();
  const p = t.portfolio;
  const [file, setFile] = useState<File | null>(null);
  const [password, setPassword] = useState("");
  const [state, setState] = useState<State>({ status: "idle" });
  const passwordRef = useRef<HTMLInputElement>(null);

  const read = async (event: FormEvent) => {
    event.preventDefault();
    if (!file) return;
    setState({ status: "reading" });
    try {
      const [statement, data] = await Promise.all([
        parseCas(file, password || undefined),
        loadFundData(),
      ]);
      setState({ status: "done", statement, result: checkup(statement, data) });
    } catch (error) {
      const passwordProblem = error instanceof CasPasswordError;
      // A layout error names the row it could not read, which only the parser's own
      // (English) message carries.
      setState({
        status: "error",
        password: passwordProblem,
        message: passwordProblem
          ? error.incorrect
            ? p.errors.wrongPassword
            : p.errors.needsPassword
          : error instanceof CasFormatError
            ? error.reason === "layout"
              ? error.message
              : p.errors[error.reason]
            : p.errors.unreadable((error as Error).message),
      });
      if (passwordProblem) passwordRef.current?.focus();
    }
  };

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{p.title}</h1>
        <p className="max-w-3xl text-sm text-ink-500">{p.intro}</p>
      </header>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title={p.yourStatement}>
          <form className="space-y-4" onSubmit={read}>
            <label
              className="flex cursor-pointer flex-col items-center gap-1 rounded-xl border border-dashed border-ink-300 px-4 py-8 text-center hover:border-accent-500 hover:bg-accent-50 focus-within:border-accent-500"
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const dropped = e.dataTransfer.files[0];
                if (dropped) setFile(dropped);
              }}
            >
              <span className="text-sm font-medium text-ink-900">
                {file ? file.name : p.choose}
              </span>
              <span className="text-xs text-ink-500">{file ? p.chooseAnother : p.chooseHint}</span>
              <input
                type="file"
                accept="application/pdf,.pdf"
                className="sr-only"
                aria-label={p.fileLabel}
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
            </label>
            <Field label={p.password}>
              <input
                ref={passwordRef}
                type="password"
                autoComplete="off"
                className={`${inputClass} w-full`}
                placeholder={p.passwordPlaceholder}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                aria-invalid={state.status === "error" && state.password}
              />
            </Field>
            <div className="flex flex-wrap items-center gap-3">
              <Button
                variant="primary"
                type="submit"
                disabled={!file || state.status === "reading"}
              >
                {state.status === "reading" ? p.reading : p.read}
              </Button>
              <span className="text-xs text-ink-500">{p.local}</span>
            </div>
            {state.status === "error" ? (
              <p
                role="alert"
                className="rounded-lg border border-bad-300 bg-bad-50 p-3 text-sm text-bad-900"
              >
                {state.message}
              </p>
            ) : null}
          </form>
          <p className="mt-4 rounded-xl border-l-2 border-accent-500 bg-accent-50 p-3 text-xs leading-relaxed text-ink-700">
            <strong className="text-ink-900">{p.private}</strong> {p.privateBody}
          </p>
        </Card>

        <Card title={p.howTo}>
          <ol className="list-decimal space-y-2 pl-5 text-sm text-ink-700 marker:text-ink-500">
            <li>
              {p.step1.before}
              <a
                className="text-accent-600 underline"
                href="https://www.camsonline.com/Investors/Statements/Consolidated-Account-Statement"
                target="_blank"
                rel="noreferrer"
              >
                {p.step1.cams}
              </a>
              {p.step1.choose}
              <em>{p.step1.choice}</em>
              {p.step1.kfintech}
              <a
                className="text-accent-600 underline"
                href="https://mfs.kfintech.com/investor/General/ConsolidatedAccountStatement"
                target="_blank"
                rel="noreferrer"
              >
                {p.step1.kfintechLink}
              </a>
              {p.step1.after}
            </li>
            <li>
              {p.step2.before}
              <strong>{p.step2.detailed}</strong>
              {p.step2.period}
              <strong>{p.step2.specific}</strong>
              {p.step2.after}
            </li>
            <li>{p.step3}</li>
            <li>{p.step4}</li>
          </ol>
          <p className="mt-4 text-xs text-ink-500">
            {p.demat}{" "}
            <a
              className="underline"
              href="https://www.amfiindia.com/investor-corner/investor-center/cas.html"
              target="_blank"
              rel="noreferrer"
            >
              {p.amfi}
            </a>
            .
          </p>
        </Card>
      </div>

      {state.status === "done" ? (
        <Results statement={state.statement} result={state.result} />
      ) : null}
    </div>
  );
}

function Value({ figure, format }: { figure: Figure; format: (v: number) => string }) {
  const { t } = useI18n();
  if (figure.value !== null) return <span className="numeric">{format(figure.value)}</span>;
  const reason = t.portfolio.reasons[figure.reason];
  return (
    <MissingValue reason={figure.holding ? t.portfolio.reasonIn(figure.holding, reason) : reason} />
  );
}

function Results({ statement, result }: { statement: CasStatement; result: Checkup }) {
  const { t } = useI18n();
  const p = t.portfolio;
  const { number, rupees, signedRupees } = useFormat();
  const regular = result.holdings.filter((h) => h.direct);
  return (
    <div className="space-y-5">
      <p className="text-sm text-ink-700">
        {p.summary({
          investor: statement.investorName,
          period: statement.period,
          holdings: result.holdings.length,
          holdingsShown: number(result.holdings.length),
          redeemed: result.redeemedCount,
          redeemedShown: number(result.redeemedCount),
        })}
      </p>

      <section aria-label={p.totals} className="grid grid-cols-2 gap-3 lg:grid-cols-6">
        <Stat
          label={p.currentValue}
          value={rupees(result.value)}
          hint={
            result.unvaluedCount
              ? p.unvalued(result.unvaluedCount, number(result.unvaluedCount))
              : undefined
          }
        />
        <Stat
          label={p.costHeld}
          value={<Value figure={result.cost} format={rupees} />}
          tooltip={p.costHeldHint}
        />
        <Stat label={p.gain} value={<Value figure={result.gain} format={signedRupees} />} />
        <Stat
          label={p.xirr}
          value={<Value figure={result.xirr} format={(v) => formatPercent(v)} />}
          tooltip={p.xirrHint}
        />
        <Stat
          label={p.yearlyCost}
          value={rupees(result.yearlyCost.value)}
          hint={p.covered(number(result.yearlyCost.covered), number(result.holdings.length))}
          tooltip={p.yearlyCostHint}
        />
        <Stat
          label={p.regularVsDirect}
          value={result.directDifference.count ? rupees(result.directDifference.value) : "-"}
          hint={p.compared(result.directDifference.count, number(result.directDifference.count))}
          tooltip={p.regularVsDirectHint}
        />
      </section>

      <Card title={p.holdings} subtitle={p.holdingsHint}>
        <div className="scroll-x -mx-5 overflow-x-auto px-5">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-ink-500 [&_th]:px-3 [&_th]:pb-2 [&_th]:font-medium [&_th]:whitespace-nowrap">
                <th className="!pl-0">{p.columns.fund}</th>
                <th className="text-right">{p.columns.units}</th>
                <th className="text-right">{p.columns.nav}</th>
                <th className="text-right">{p.columns.value}</th>
                <th className="text-right">{p.columns.cost}</th>
                <th className="text-right">{p.columns.gain}</th>
                <th className="text-right">{p.columns.xirr}</th>
                <th className="text-right">{p.columns.expenseRatio}</th>
                <th className="text-right">{p.columns.costPerYear}</th>
              </tr>
            </thead>
            <tbody className="[&_td]:px-3 [&_td]:py-2.5 [&_td]:align-top">
              {result.holdings.map((h) => (
                <HoldingRow key={h.key} holding={h} />
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {regular.length ? <DirectPlans holdings={regular} /> : null}

      <div className="grid gap-4 md:grid-cols-2">
        <Card title={p.byCategory}>
          <Bars slices={result.categories} />
        </Card>
        <Card title={p.bySubCategory}>
          <Bars slices={result.subCategories} />
        </Card>
      </div>

      <StyleOverlap holdings={result.holdings} />

      <p className="rounded-xl border-l-2 border-warn-300 bg-warn-50 p-4 text-sm text-warn-900">
        {p.notAdvice}
      </p>
    </div>
  );
}

function FundLink({ code, name }: { code: string | null; name: string }) {
  return code ? (
    <Link
      href={`/fund/${code}`}
      className="font-medium text-ink-900 hover:text-accent-600 hover:underline"
    >
      {name}
    </Link>
  ) : (
    <span className="font-medium text-ink-900">{name}</span>
  );
}

function HoldingRow({ holding: h }: { holding: Holding }) {
  const { t } = useI18n();
  const p = t.portfolio;
  const { number, rupees, signedRupees, units } = useFormat();
  const right = "text-right whitespace-nowrap";
  return (
    <tr className="border-t border-ink-100">
      <td className="min-w-56 max-w-80 !pl-0">
        <FundLink code={h.schemeCode} name={h.name} />
        <span className="mt-0.5 block text-xs text-ink-500">
          {[h.subCategory, h.plan, p.folio(h.folios.join(", "))].filter(Boolean).join(" · ")}
        </span>
        {h.nav?.source === "statement" ? (
          <span className="mt-1 inline-block">
            <InfoTooltip label={<Badge tone="warn">{p.statementValuation}</Badge>}>
              {p.statementValuationHint(h.nav.date)}
            </InfoTooltip>
          </span>
        ) : null}
      </td>
      <td className={right}>
        <span className="numeric">{units(h.units)}</span>
      </td>
      <td className={right}>
        {h.nav ? (
          <>
            <span className="numeric">
              {number(h.nav.value, { minimumFractionDigits: 2, maximumFractionDigits: 4 })}
            </span>
            <span className="block text-[11px] text-ink-500">{h.nav.date}</span>
          </>
        ) : (
          <MissingValue reason={p.noNav} />
        )}
      </td>
      <td className={right}>
        <Value figure={h.value} format={rupees} />
      </td>
      <td className={right}>
        <Value figure={h.cost} format={rupees} />
      </td>
      <td className={right}>
        <Value figure={h.gain} format={signedRupees} />
      </td>
      <td className={right}>
        <Value figure={h.xirr} format={(v) => formatPercent(v)} />
      </td>
      <td className={right}>
        {h.expenseRatio === null ? (
          <MissingValue reason={h.yearlyCost.reason && p.reasons[h.yearlyCost.reason]} />
        ) : (
          <span className="numeric">{formatPercent(h.expenseRatio)}</span>
        )}
      </td>
      <td className={right}>
        <Value figure={h.yearlyCost} format={rupees} />
      </td>
    </tr>
  );
}

function DirectPlans({ holdings }: { holdings: Holding[] }) {
  const { t } = useI18n();
  const p = t.portfolio;
  const { rupees } = useFormat();
  return (
    <Card title={p.directPlans} subtitle={p.directPlansHint}>
      <ul className="divide-y divide-ink-100">
        {holdings.map((h) => {
          const direct = h.direct!;
          return (
            <li key={h.key} className="grid gap-2 py-3 sm:grid-cols-[1fr_auto] sm:items-center">
              <div className="min-w-0 text-sm">
                <FundLink code={h.schemeCode} name={h.name} />
                {"schemeCode" in direct ? (
                  <span className="mt-1 block text-xs text-ink-500">
                    {p.expenseRatio}{" "}
                    <span className="numeric">{formatPercent(h.expenseRatio)}</span>. {p.directPlan}{" "}
                    <Link
                      className="text-accent-600 hover:underline"
                      href={`/fund/${direct.schemeCode}`}
                    >
                      {direct.name}
                    </Link>
                    : <span className="numeric">{formatPercent(direct.expenseRatio)}</span>
                  </span>
                ) : (
                  <span className="mt-1 block text-xs text-ink-500">
                    {p.reasons[direct.reason]}
                  </span>
                )}
              </div>
              {"schemeCode" in direct ? (
                <div className="text-sm whitespace-nowrap sm:text-right">
                  <span className="text-ink-500">{p.difference} </span>
                  <Value figure={direct.difference} format={rupees} />
                  <span className="text-ink-500"> {p.aYear}</span>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
      <p className="mt-3 border-t border-ink-100 pt-3 text-xs text-ink-500">{p.directNote}</p>
    </Card>
  );
}

function Bars({ slices }: { slices: Slice[] }) {
  const { t } = useI18n();
  const { rupees } = useFormat();
  return (
    <ul className="space-y-2.5">
      {slices.map((s) => (
        <li key={s.name ?? ""} className="text-sm">
          <div className="flex items-baseline justify-between gap-3">
            <span className="min-w-0 truncate text-ink-700">{s.name ?? t.portfolio.notInData}</span>
            <span className="shrink-0 text-ink-500 numeric">
              {rupees(s.value)} · {formatPercent(s.share, 1)}
            </span>
          </div>
          <span className="mt-1 block h-2 overflow-hidden rounded-full bg-ink-100">
            <span
              className="block h-full rounded-full bg-accent-500"
              style={{ width: `${s.share * 100}%` }}
            />
          </span>
        </li>
      ))}
    </ul>
  );
}

// About the top 7% of pairs among direct growth funds in the export: two diversified equity
// funds commonly share half their estimated mix, so a lower bar would flag most pairs.
const STYLE_THRESHOLD = 0.75;

function StyleOverlap({ holdings }: { holdings: Holding[] }) {
  const { t, number } = useI18n();
  const p = t.portfolio;
  const codes = holdings.flatMap((h) => (h.schemeCode ? [h.schemeCode] : []));
  const key = codes.join(",");
  const [result, setResult] = useState<{ pairs: StylePair[]; fitted: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all(key.split(",").filter(Boolean).map(getSchemeExposure))
      .then((exposures) => {
        const fitted = exposures.flatMap((e) =>
          e.reason === null && e.weights.length
            ? [
                {
                  schemeCode: e.scheme_code,
                  weights: new Map(e.weights.map((w) => [w.benchmark_id, w.weight])),
                },
              ]
            : [],
        );
        if (!cancelled)
          setResult({ pairs: styleOverlaps(fitted, STYLE_THRESHOLD), fitted: fitted.length });
      })
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [key]);

  const name = (code: string) => holdings.find((h) => h.schemeCode === code)?.name ?? code;
  const share = formatPercent(STYLE_THRESHOLD, 0);
  let body: ReactNode;
  if (error) body = <p className="text-sm text-bad-700">{error}</p>;
  else if (!result) body = <p className="text-sm text-ink-500">{p.loadingStyle}</p>;
  else if (result.fitted < 2) body = <p className="text-sm text-ink-700">{p.fewStyles}</p>;
  else if (!result.pairs.length)
    body = <p className="text-sm text-ink-700">{p.noSimilar(number(result.fitted), share)}</p>;
  else
    body = (
      <ul className="divide-y divide-ink-100">
        {result.pairs.map((pair) => (
          <li key={`${pair.a}-${pair.b}`} className="flex items-center gap-3 py-2.5 text-sm">
            <span className="min-w-0 flex-1">
              <FundLink code={pair.a} name={name(pair.a)} />
              <span className="text-ink-500">{p.and}</span>
              <FundLink code={pair.b} name={name(pair.b)} />
            </span>
            <span className="shrink-0 font-semibold numeric">{formatPercent(pair.overlap, 0)}</span>
          </li>
        ))}
      </ul>
    );

  return (
    <Card title={p.similarStyle} subtitle={p.similarStyleHint(share)}>
      {body}
      <p className="mt-3 border-t border-ink-100 pt-3 text-xs text-ink-500">{p.styleNote}</p>
    </Card>
  );
}
