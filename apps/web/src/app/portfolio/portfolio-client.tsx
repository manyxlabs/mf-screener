"use client";

import { formatPercent } from "@mf/shared";
import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { MissingValue } from "@/components/metric-cell";
import { InfoTooltip } from "@/components/tooltip";
import { Badge, Button, Card, Field, inputClass, Stat } from "@/components/ui";
import { getSchemeExposure } from "@/lib/api";
import { CasFormatError, CasPasswordError, parseCas } from "@/lib/cas/parse";
import type { CasStatement } from "@/lib/cas/types";
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

const rupees = (v: number) =>
  `${v < 0 ? "-" : ""}₹${Math.abs(Math.round(v)).toLocaleString("en-IN")}`;
const signedRupees = (v: number) => `${v > 0 ? "+" : ""}${rupees(v)}`;
const units = (v: number) =>
  v.toLocaleString("en-IN", { minimumFractionDigits: 3, maximumFractionDigits: 3 });

export function PortfolioClient() {
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
      setState({
        status: "error",
        password: passwordProblem,
        message: passwordProblem
          ? error.incorrect
            ? "That password did not open the statement. It is the one you chose when you requested the CAS."
            : "This statement is password protected. Enter the password you chose when you requested it."
          : error instanceof CasFormatError
            ? error.message
            : `The statement could not be read: ${(error as Error).message}`,
      });
      if (passwordProblem) passwordRef.current?.focus();
    }
  };

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Portfolio checkup</h1>
        <p className="max-w-3xl text-sm text-ink-500">
          Open your consolidated account statement to see your mutual fund holdings at the latest
          NAV, the return your own cash flows earned, where the money sits and what expense ratios
          cost you in rupees each year.
        </p>
      </header>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Your statement">
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
                {file ? file.name : "Choose or drop your CAS PDF"}
              </span>
              <span className="text-xs text-ink-500">
                {file ? "Choose another file" : "The detailed CAMS/KFintech statement"}
              </span>
              <input
                type="file"
                accept="application/pdf,.pdf"
                className="sr-only"
                aria-label="CAS PDF"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
            </label>
            <Field label="Statement password">
              <input
                ref={passwordRef}
                type="password"
                autoComplete="off"
                className={`${inputClass} w-full`}
                placeholder="The password you set when requesting it"
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
                {state.status === "reading" ? "Reading..." : "Read statement"}
              </Button>
              <span className="text-xs text-ink-500">Nothing leaves this browser tab.</span>
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
            <strong className="text-ink-900">Private by construction.</strong> The PDF is read by
            this page inside your browser. This site is static files with no server that could
            receive it, so nothing is uploaded, stored or logged, and closing the tab discards it.
          </p>
        </Card>

        <Card title="How to get your CAS">
          <ol className="list-decimal space-y-2 pl-5 text-sm text-ink-700 marker:text-ink-500">
            <li>
              Open the{" "}
              <a
                className="text-accent-600 underline"
                href="https://www.camsonline.com/Investors/Statements/Consolidated-Account-Statement"
                target="_blank"
                rel="noreferrer"
              >
                CAMS consolidated account statement page
              </a>{" "}
              and choose <em>CAS - CAMS + KFintech</em>, which covers funds serviced by both
              registrars. KFintech offers the same statement on its{" "}
              <a
                className="text-accent-600 underline"
                href="https://mfs.kfintech.com/investor/General/ConsolidatedAccountStatement"
                target="_blank"
                rel="noreferrer"
              >
                investor site
              </a>
              .
            </li>
            <li>
              Pick statement type <strong>Detailed</strong> (it includes the transaction listing),
              period <strong>Specific period</strong> from 01-Jan-1990 to today, and folio listing
              with zero-balance folios. A statement that starts later leaves out the cost of earlier
              purchases, so no return can be computed from it.
            </li>
            <li>Enter the email registered on your folios. PAN is optional.</li>
            <li>
              Choose a password for the PDF. It arrives by email, usually within minutes; open it
              here with that password.
            </li>
          </ol>
          <p className="mt-4 text-xs text-ink-500">
            Depository statements from NSDL or CDSL are a different format and are not read here.{" "}
            <a
              className="underline"
              href="https://www.amfiindia.com/investor-corner/investor-center/cas.html"
              target="_blank"
              rel="noreferrer"
            >
              AMFI explains the CAS
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
  return figure.value === null ? (
    <MissingValue reason={figure.reason} />
  ) : (
    <span className="numeric">{format(figure.value)}</span>
  );
}

function Results({ statement, result }: { statement: CasStatement; result: Checkup }) {
  const regular = result.holdings.filter((h) => h.direct);
  return (
    <div className="space-y-5">
      <p className="text-sm text-ink-700">
        {statement.investorName ? `Statement for ${statement.investorName}` : "Statement"}
        {statement.period ? `, ${statement.period.from} to ${statement.period.to}` : ""}.{" "}
        {result.holdings.length} holding{result.holdings.length === 1 ? "" : "s"}
        {result.redeemedCount
          ? `, plus ${result.redeemedCount} fully redeemed (counted in the return)`
          : ""}
        . Units are as of the statement, valued at the latest NAV in this site&rsquo;s data.
      </p>

      <section aria-label="Portfolio totals" className="grid grid-cols-2 gap-3 lg:grid-cols-6">
        <Stat
          label="Current value"
          value={rupees(result.value)}
          hint={
            result.unvaluedCount
              ? `${result.unvaluedCount} holding without a value left out`
              : undefined
          }
        />
        <Stat
          label="Cost of units held"
          value={<Value figure={result.cost} format={rupees} />}
          tooltip="What was paid for the units still held, matching sales against the oldest units first. Reinvested payouts count at their reinvested amount; stamp duty is left out."
        />
        <Stat label="Gain" value={<Value figure={result.gain} format={signedRupees} />} />
        <Stat
          label="XIRR"
          value={<Value figure={result.xirr} format={(v) => formatPercent(v)} />}
          tooltip="The annual rate that makes every purchase, redemption, payout and tax in the statement, plus today's value, net to zero. Funds since redeemed count too. It is your return on your own timing, not the funds' published returns."
        />
        <Stat
          label="Expense ratios per year"
          value={rupees(result.yearlyCost.value)}
          hint={`${result.yearlyCost.covered} of ${result.holdings.length} holdings`}
          tooltip="Each fund's current total expense ratio applied to today's value. The fund takes this out of the NAV daily, so it is already inside every return shown here."
        />
        <Stat
          label="Regular vs direct per year"
          value={result.directDifference.count ? rupees(result.directDifference.value) : "-"}
          hint={`${result.directDifference.count} regular-plan holding${result.directDifference.count === 1 ? "" : "s"} compared`}
          tooltip="For holdings in a regular plan: the gap between its expense ratio and its direct plan's, applied to today's value."
        />
      </section>

      <Card title="Holdings" subtitle="Funds held in more than one folio are added together.">
        <div className="scroll-x -mx-5 overflow-x-auto px-5">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-ink-500 [&_th]:px-3 [&_th]:pb-2 [&_th]:font-medium [&_th]:whitespace-nowrap">
                <th className="!pl-0">Fund</th>
                <th className="text-right">Units</th>
                <th className="text-right">NAV</th>
                <th className="text-right">Value</th>
                <th className="text-right">Cost</th>
                <th className="text-right">Gain</th>
                <th className="text-right">XIRR</th>
                <th className="text-right">Expense ratio</th>
                <th className="text-right">Cost per year</th>
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
        <Card title="By category">
          <Bars slices={result.categories} />
        </Card>
        <Card title="By sub-category">
          <Bars slices={result.subCategories} />
        </Card>
      </div>

      <StyleOverlap holdings={result.holdings} />

      <p className="rounded-xl border-l-2 border-warn-300 bg-warn-50 p-4 text-sm text-warn-900">
        These are figures from your statement and the published data, not advice. Expense ratios and
        NAVs are the latest this site has; a fund&rsquo;s past return says nothing certain about its
        next one.
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
  const right = "text-right whitespace-nowrap";
  return (
    <tr className="border-t border-ink-100">
      <td className="min-w-56 max-w-80 !pl-0">
        <FundLink code={h.schemeCode} name={h.name} />
        <span className="mt-0.5 block text-xs text-ink-500">
          {[h.subCategory, h.plan, `Folio ${h.folios.join(", ")}`].filter(Boolean).join(" · ")}
        </span>
        {h.nav?.source === "statement" ? (
          <span className="mt-1 inline-block">
            <InfoTooltip label={<Badge tone="warn">Statement valuation</Badge>}>
              This scheme is not in the site&rsquo;s data, usually because it closed or merged into
              another, so it is valued at the statement&rsquo;s own NAV of {h.nav.date}.
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
              {h.nav.value.toLocaleString("en-IN", {
                minimumFractionDigits: 2,
                maximumFractionDigits: 4,
              })}
            </span>
            <span className="block text-[11px] text-ink-500">{h.nav.date}</span>
          </>
        ) : (
          <MissingValue reason="No NAV in the site's data or the statement." />
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
          <MissingValue reason={h.yearlyCost.reason} />
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
  return (
    <Card
      title="Regular plans and their direct plans"
      subtitle="The same fund and portfolio, sold without a distributor's commission inside the expense ratio."
    >
      <ul className="divide-y divide-ink-100">
        {holdings.map((h) => {
          const direct = h.direct!;
          return (
            <li key={h.key} className="grid gap-2 py-3 sm:grid-cols-[1fr_auto] sm:items-center">
              <div className="min-w-0 text-sm">
                <FundLink code={h.schemeCode} name={h.name} />
                {"schemeCode" in direct ? (
                  <span className="mt-1 block text-xs text-ink-500">
                    Expense ratio <span className="numeric">{formatPercent(h.expenseRatio)}</span>.
                    Direct plan{" "}
                    <Link
                      className="text-accent-600 hover:underline"
                      href={`/fund/${direct.schemeCode}`}
                    >
                      {direct.name}
                    </Link>
                    : <span className="numeric">{formatPercent(direct.expenseRatio)}</span>
                  </span>
                ) : (
                  <span className="mt-1 block text-xs text-ink-500">{direct.reason}</span>
                )}
              </div>
              {"schemeCode" in direct ? (
                <div className="text-sm whitespace-nowrap sm:text-right">
                  <span className="text-ink-500">Difference </span>
                  <Value figure={direct.difference} format={rupees} />
                  <span className="text-ink-500"> a year</span>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
      <p className="mt-3 border-t border-ink-100 pt-3 text-xs text-ink-500">
        The yearly figure is the gap between the two expense ratios applied to today&rsquo;s value,
        so it moves with the value and the ratios. Moving between plans is a redemption and a new
        purchase, so any exit load and capital gains tax on the redemption apply.
      </p>
    </Card>
  );
}

function Bars({ slices }: { slices: Slice[] }) {
  return (
    <ul className="space-y-2.5">
      {slices.map((s) => (
        <li key={s.name} className="text-sm">
          <div className="flex items-baseline justify-between gap-3">
            <span className="min-w-0 truncate text-ink-700">{s.name}</span>
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
  let body: ReactNode;
  if (error) body = <p className="text-sm text-bad-700">{error}</p>;
  else if (!result) body = <p className="text-sm text-ink-500">Loading style estimates...</p>;
  else if (result.fitted < 2)
    body = (
      <p className="text-sm text-ink-700">
        Fewer than two holdings have a style estimate, so there is nothing to compare. Debt, gold
        and international funds, and funds under two years old, have none.
      </p>
    );
  else if (!result.pairs.length)
    body = (
      <p className="text-sm text-ink-700">
        No two of the {result.fitted} funds with a style estimate share{" "}
        {formatPercent(STYLE_THRESHOLD, 0)} or more of it.
      </p>
    );
  else
    body = (
      <ul className="divide-y divide-ink-100">
        {result.pairs.map((p) => (
          <li key={`${p.a}-${p.b}`} className="flex items-center gap-3 py-2.5 text-sm">
            <span className="min-w-0 flex-1">
              <FundLink code={p.a} name={name(p.a)} />
              <span className="text-ink-500"> and </span>
              <FundLink code={p.b} name={name(p.b)} />
            </span>
            <span className="shrink-0 font-semibold numeric">{formatPercent(p.overlap, 0)}</span>
          </li>
        ))}
      </ul>
    );

  return (
    <Card
      title="Funds with a similar style"
      subtitle={`Pairs whose estimated style mixes share ${formatPercent(STYLE_THRESHOLD, 0)} or more, as the sum of the smaller weight on each index.`}
    >
      {body}
      <p className="mt-3 border-t border-ink-100 pt-3 text-xs text-ink-500">
        Each fund&rsquo;s mix of index returns is fitted from how its NAV moved, as on its fund
        page, not read from holdings: two funds can share a style and hold different stocks.
      </p>
    </Card>
  );
}
