"use client";

import type { Scheme } from "@mf/shared";
import { formatPercent } from "@mf/shared";
import Link from "next/link";
import { Fragment, useEffect, useMemo, useState } from "react";
import { FundPicker } from "@/components/fund-picker";
import { Badge, Button, Card, Field, inputClass, PercentInput, Stat } from "@/components/ui";
import { getScheme, getSchemeNav } from "@/lib/api";
import { CasFormatError, CasPasswordError, parseCas } from "@/lib/cas/parse";
import { tradesFromCas } from "@/lib/capital-gains/cas";
import { loadFundData } from "@/lib/portfolio";
import {
  computeGains,
  type GainsResult,
  type Holding,
  type OpenLot,
  type RealisedLot,
  type YearSummary,
} from "@/lib/capital-gains/engine";
import { fundTypeFromCategory, looksListed } from "@/lib/capital-gains/fund-type";
import {
  CESS,
  fyLabel,
  GRANDFATHER_BEFORE,
  sectionName,
  type FundType,
  type TaxHead,
} from "@/lib/capital-gains/rules";
import { SOURCES } from "./sources";

const MAX_FUNDS = 20;
// One height for selects, dates and numbers, which browsers otherwise size differently.
const CONTROL = `${inputClass} h-10 w-full`;
const STORAGE_KEY = "mf-screener.capital-gains.v1";

const FUND_TYPES: [FundType, string][] = [
  ["equity", "Equity-oriented (65%+ Indian equity)"],
  ["hybrid", "Hybrid (35-65% Indian equity)"],
  ["debt", "Debt (over 65% in debt)"],
  ["other", "Gold, silver, overseas or other FoF"],
];

type Row = {
  id: string;
  side: "buy" | "sell";
  date: string;
  units: string;
  value: string;
  valueKind: "nav" | "amount";
};
/** Only what the user typed is stored; fund data is read fresh on every visit. */
type Fund = {
  code: string;
  /** Set for a fund imported from a CAS: first-in first-out runs within each folio. */
  folio?: string;
  name: string;
  type: FundType | null;
  /** Null follows the name; stored data from before the field existed reads as null. */
  listed?: boolean | null;
  nav31Jan2018: string;
  rows: Row[];
};
type Saved = { funds: Fund[]; slabRate: string };
type Info =
  | {
      guess: FundType | null;
      latest: { date: string; nav: number } | null;
      /** The month-end NAV for January 2018 in the site's monthly series. */
      nav31Jan2018: number | null;
    }
  | { error: string };

const newRow = (): Row => ({
  id: Math.random().toString(36).slice(2),
  side: "buy",
  date: "",
  units: "",
  value: "",
  valueKind: "nav",
});

function load(): Saved {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "null") as Saved | null;
    if (parsed && Array.isArray(parsed.funds) && typeof parsed.slabRate === "string") return parsed;
  } catch {
    // unreadable or blocked storage starts empty
  }
  return { funds: [], slabRate: "" };
}

function save(saved: Saved) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
  } catch {
    // storage blocked or full: the page still works for this visit
  }
}

async function loadInfo(code: string): Promise<Info> {
  try {
    const [{ scheme }, nav] = await Promise.all([getScheme(code), getSchemeNav(code)]);
    const jan2018 = nav.points.find((p) => p.date === "2018-01-31");
    return {
      guess: fundTypeFromCategory(
        scheme.clean_category,
        scheme.clean_sub_category,
        scheme.scheme_name,
      ),
      latest:
        scheme.latest_nav !== null && scheme.latest_nav_date
          ? { date: scheme.latest_nav_date, nav: scheme.latest_nav }
          : null,
      nav31Jan2018: jan2018?.nav ?? null,
    };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

const num = (raw: string) => (raw.trim() === "" ? null : Number(raw));
const complete = (row: Row) =>
  row.date !== "" && num(row.units) !== null && num(row.value) !== null;

const keyOf = (fund: Fund) => (fund.folio ? `${fund.folio}:${fund.code}` : fund.code);
const labelOf = (fund: Fund) => (fund.folio ? `${fund.name} (folio ${fund.folio})` : fund.name);

const isListed = (fund: Fund) => fund.listed ?? looksListed(fund.name);

function toHolding(fund: Fund, info: Info | undefined): Holding | null {
  const ok = info && !("error" in info) ? info : null;
  const type = fund.type ?? ok?.guess ?? null;
  if (type === null) return null;
  const listed = isListed(fund);
  return {
    id: keyOf(fund),
    name: fund.name,
    type,
    listed,
    // A listed unit's 2018 value is its traded price, which the NAV series does not hold.
    nav31Jan2018: num(fund.nav31Jan2018) ?? (listed ? null : (ok?.nav31Jan2018 ?? null)),
    latest: ok?.latest ?? null,
    trades: fund.rows.filter(complete).map((row) => {
      const units = Number(row.units);
      const value = Number(row.value);
      return {
        date: row.date,
        side: row.side,
        units,
        amount: row.valueKind === "nav" ? units * value : value,
      };
    }),
  };
}

const rupees = (value: number) =>
  `${value < 0 ? "-" : ""}₹${Math.abs(Math.round(value)).toLocaleString("en-IN")}`;
const units = (value: number) => value.toLocaleString("en-IN", { maximumFractionDigits: 4 });
const today = () => new Date().toLocaleDateString("en-CA");

export function CapitalGainsClient() {
  const [saved, setSaved] = useState<Saved | null>(null);
  const [info, setInfo] = useState<Record<string, Info>>({});

  // Read after mount: the static page is rendered without the visitor's storage.
  useEffect(() => setSaved(load()), []);
  useEffect(() => {
    if (saved) save(saved);
  }, [saved]);

  const codes = saved?.funds.map((f) => f.code).join(",") ?? "";
  useEffect(() => {
    let cancelled = false;
    for (const code of codes.split(",").filter(Boolean)) {
      loadInfo(code).then((loaded) => {
        if (!cancelled) setInfo((current) => ({ ...current, [code]: loaded }));
      });
    }
    return () => {
      cancelled = true;
    };
  }, [codes]);

  const slabRate = num(saved?.slabRate ?? "");
  const holdings = useMemo(
    () =>
      saved?.funds
        .map((fund) => toHolding(fund, info[fund.code]))
        .filter((h): h is Holding => h !== null && h.trades.length > 0) ?? [],
    [saved, info],
  );
  const result = useMemo(
    () => (holdings.length ? computeGains(holdings, { asOf: today(), slabRate }) : null),
    [holdings, slabRate],
  );

  if (!saved) return <p className="text-sm text-ink-500">Loading calculator...</p>;

  const update = (key: string, change: (fund: Fund) => Fund) =>
    setSaved({ ...saved, funds: saved.funds.map((f) => (keyOf(f) === key ? change(f) : f)) });
  const addFund = (scheme: Scheme) => {
    if (saved.funds.length >= MAX_FUNDS || saved.funds.some((f) => keyOf(f) === scheme.scheme_code))
      return;
    const fund: Fund = {
      code: scheme.scheme_code,
      name: scheme.scheme_name,
      type: null,
      nav31Jan2018: "",
      rows: [newRow()],
    };
    setSaved({ ...saved, funds: [...saved.funds, fund] });
  };
  const nameOf = Object.fromEntries(saved.funds.map((f) => [keyOf(f), labelOf(f)]));
  // Imported funds replace any earlier copy of the same folio, so importing twice is harmless.
  const addImported = (funds: Fund[]) => {
    const keys = new Set(funds.map(keyOf));
    setSaved({ ...saved, funds: [...saved.funds.filter((f) => !keys.has(keyOf(f))), ...funds] });
  };

  return (
    <div className="space-y-6">
      <Disclaimer />

      <CasImport onImport={addImported} />

      <FundPicker
        label="Or search funds to add them by hand"
        chosen={saved.funds.filter((f) => !f.folio).map((f) => f.code)}
        max={MAX_FUNDS}
        onPick={addFund}
      />

      {saved.funds.length ? (
        <div className="space-y-4">
          {saved.funds.map((fund) => (
            <FundCard
              key={keyOf(fund)}
              fund={fund}
              info={info[fund.code]}
              onChange={(change) => update(keyOf(fund), change)}
              onRemove={() =>
                setSaved({ ...saved, funds: saved.funds.filter((f) => keyOf(f) !== keyOf(fund)) })
              }
            />
          ))}
        </div>
      ) : (
        <div className="rounded-2xl border border-dashed border-ink-300 px-6 py-14 text-center">
          <p className="text-base font-semibold text-ink-900">No funds added yet</p>
          <p className="mx-auto mt-2 max-w-md text-sm text-ink-500">
            Add a fund with the search above, then enter each purchase and redemption with its date,
            units and NAV or amount.
          </p>
        </div>
      )}

      <Card title="Your slab rate" subtitle="Optional. Used only for gains taxed at the slab rate.">
        <div className="flex flex-wrap items-center gap-3">
          <PercentInput
            ariaLabel="Slab rate"
            className="w-28"
            placeholder="e.g. 30"
            value={slabRate ?? undefined}
            onChange={(decimal) => setSaved({ ...saved, slabRate: decimal })}
          />
          <p className="max-w-xl text-xs text-ink-500">
            Short-term gains on debt funds, and on other non-equity funds held too briefly, are
            added to your income and taxed at your slab rate. Without one, those gains are shown but
            their tax is not estimated.
          </p>
        </div>
      </Card>

      {result ? <Results result={result} nameOf={nameOf} /> : null}

      <Sources />
    </div>
  );
}

type ImportState =
  | { status: "idle" }
  | { status: "reading" }
  | { status: "done"; added: number; skipped: string[] }
  | { status: "error"; message: string; password: boolean };

/** Fills the calculator from a CAMS/KFintech statement, read in the browser like the checkup does. */
function CasImport({ onImport }: { onImport: (funds: Fund[]) => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [password, setPassword] = useState("");
  const [state, setState] = useState<ImportState>({ status: "idle" });

  async function read() {
    if (!file) return;
    setState({ status: "reading" });
    try {
      const [statement, data] = await Promise.all([
        parseCas(file, password || undefined),
        loadFundData(),
      ]);
      const funds: Fund[] = [];
      const skipped: string[] = [];
      for (const scheme of statement.schemes) {
        const row = scheme.isin ? data.byIsin.get(scheme.isin) : undefined;
        const code = scheme.amfiCode ?? row?.scheme_code ?? null;
        const traded = tradesFromCas(scheme);
        if (!code) skipped.push(`${scheme.name}: not in this site's data`);
        else if ("unsupported" in traded) skipped.push(`${scheme.name}: ${traded.unsupported}`);
        else if (traded.trades.length)
          funds.push({
            code,
            folio: scheme.folio,
            name: row?.scheme_name ?? scheme.name,
            type: null,
            nav31Jan2018: "",
            rows: traded.trades.map((t) => ({
              ...newRow(),
              side: t.side,
              date: t.date,
              units: String(t.units),
              value: String(t.amount),
              valueKind: "amount",
            })),
          });
      }
      onImport(funds.slice(0, MAX_FUNDS));
      if (funds.length > MAX_FUNDS)
        skipped.push(`${funds.length - MAX_FUNDS} more funds: the calculator holds ${MAX_FUNDS}`);
      setState({ status: "done", added: Math.min(funds.length, MAX_FUNDS), skipped });
    } catch (error) {
      const password = error instanceof CasPasswordError;
      setState({
        status: "error",
        password,
        message: password
          ? error.incorrect
            ? "That password did not open the statement."
            : "This statement is password protected. Enter the password you chose when you requested it."
          : error instanceof CasFormatError
            ? error.message
            : "This file could not be read as a CAS statement.",
      });
    }
  }

  return (
    <Card
      title="Fill it from your CAS statement"
      subtitle="The detailed CAMS + KFintech statement, with transactions. Read in your browser; nothing is uploaded."
    >
      <div className="grid items-end gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,14rem)_auto]">
        <Field label="Statement (PDF)">
          <input
            type="file"
            accept="application/pdf,.pdf"
            className="block w-full text-sm text-ink-700 file:mr-3 file:rounded-lg file:border-0 file:bg-ink-100 file:px-3 file:py-2 file:text-sm file:font-medium file:text-ink-900"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </Field>
        <Field label="Statement password">
          <input
            type="password"
            className={CONTROL}
            value={password}
            autoComplete="off"
            aria-invalid={state.status === "error" && state.password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>
        <Button
          type="button"
          variant="primary"
          className="h-10"
          disabled={!file || state.status === "reading"}
          onClick={read}
        >
          {state.status === "reading" ? "Reading..." : "Add its funds"}
        </Button>
      </div>
      <div aria-live="polite" className="mt-3 text-sm">
        {state.status === "error" ? <p className="text-bad-700">{state.message}</p> : null}
        {state.status === "done" ? (
          <>
            <p className="text-ink-700">
              Added {state.added} fund{state.added === 1 ? "" : "s"}. Check the tax type of each
              below.{" "}
              <Link href="/portfolio" className="text-accent-600 hover:underline">
                The portfolio checkup
              </Link>{" "}
              reads the same statement.
            </p>
            {state.skipped.length ? (
              <details className="mt-2 text-xs text-ink-500">
                <summary className="cursor-pointer">
                  {state.skipped.length} left out, with the reason
                </summary>
                <ul className="mt-1 list-disc space-y-0.5 pl-5">
                  {state.skipped.map((reason) => (
                    <li key={reason}>{reason}</li>
                  ))}
                </ul>
              </details>
            ) : null}
          </>
        ) : null}
      </div>
    </Card>
  );
}

function Disclaimer() {
  return (
    <p className="rounded-xl border-l-2 border-warn-300 bg-warn-50 p-4 text-sm text-warn-900">
      <strong>An estimate, not tax advice.</strong> Check every figure against the Capital Gains
      Statement from CAMS or KFintech and with your tax adviser before you file. Surcharge, the
      section 87A rebate, the basic exemption limit, losses carried forward from earlier years and
      gains outside this calculator are all left out.
    </p>
  );
}

function FundCard({
  fund,
  info,
  onChange,
  onRemove,
}: {
  fund: Fund;
  info: Info | undefined;
  onChange: (change: (fund: Fund) => Fund) => void;
  onRemove: () => void;
}) {
  const ok = info && !("error" in info) ? info : null;
  const type = fund.type ?? ok?.guess ?? null;
  const listed = isListed(fund);
  const needsJan2018 =
    type === "equity" &&
    fund.rows.some((r) => r.side === "buy" && r.date && r.date < GRANDFATHER_BEFORE);
  const incomplete = fund.rows.filter((r) => !complete(r)).length;
  const setRow = (id: string, patch: Partial<Row>) =>
    onChange((f) => ({ ...f, rows: f.rows.map((r) => (r.id === id ? { ...r, ...patch } : r)) }));

  return (
    <Card
      title={
        <span className="flex items-start justify-between gap-3">
          <Link
            href={`/fund/${fund.code}`}
            className="min-w-0 hover:text-accent-600 hover:underline"
          >
            {labelOf(fund)}
          </Link>
          <button
            type="button"
            aria-label={`Remove ${fund.name}`}
            title="Remove"
            className="shrink-0 rounded-full px-1.5 text-base leading-6 font-normal text-ink-500 hover:bg-ink-100 hover:text-ink-900"
            onClick={onRemove}
          >
            ×
          </button>
        </span>
      }
    >
      {info && "error" in info ? (
        <p className="mb-3 text-xs text-bad-700">
          This fund&rsquo;s data could not be loaded ({info.error}). Choose its tax type below; the
          gain if sold today needs the latest NAV and is left out.
        </p>
      ) : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Taxed as">
          <select
            className={CONTROL}
            value={type ?? ""}
            onChange={(e) =>
              onChange((f) => ({ ...f, type: (e.target.value || null) as FundType | null }))
            }
            aria-label={`Tax type of ${fund.name}`}
          >
            {type === null ? <option value="">Choose how this fund is taxed</option> : null}
            {FUND_TYPES.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <span className="mt-1 block text-xs text-ink-500">
            {fund.type
              ? "Your choice."
              : ok?.guess
                ? "From the fund's SEBI category. Check the fund's own tax treatment and change it if it differs."
                : info
                  ? "The category does not settle this, as it depends on the fund's equity share. Check the scheme documents."
                  : "Loading the fund's category..."}
          </span>
          <label className="mt-2 flex items-center gap-2 text-sm text-ink-700">
            <input
              type="checkbox"
              className="size-4 accent-accent-500"
              checked={listed}
              onChange={(e) => onChange((f) => ({ ...f, listed: e.target.checked }))}
            />
            Listed on a stock exchange (an ETF)
          </label>
        </Field>
        {needsJan2018 ? (
          <Field label={listed ? "Highest price on 31 Jan 2018" : "NAV on 31 Jan 2018"}>
            <input
              className={CONTROL}
              type="number"
              step="any"
              min={0}
              inputMode="decimal"
              placeholder={
                !listed && ok?.nav31Jan2018 ? String(ok.nav31Jan2018) : "Not in the data: enter it"
              }
              value={fund.nav31Jan2018}
              onChange={(e) => onChange((f) => ({ ...f, nav31Jan2018: e.target.value }))}
              aria-label={`31 Jan 2018 value of ${fund.name}`}
            />
            <span className="mt-1 block text-xs text-ink-500">
              Grandfathers gains up to 31 Jan 2018 on units bought before February 2018.{" "}
              {listed
                ? "For a listed unit this is the highest price it traded at on the exchange that day."
                : ok?.nav31Jan2018
                  ? "Blank uses the last January 2018 NAV in this site's data; check it against your statement."
                  : "This site's data has no January 2018 NAV for the fund."}
            </span>
          </Field>
        ) : null}
      </div>

      {/* A statement can carry years of SIP rows; imported ones start folded so the results stay in reach. */}
      <details className="mt-5" open={!fund.folio}>
        <summary className="cursor-pointer text-sm font-medium text-ink-700">
          {fund.rows.length} transaction{fund.rows.length === 1 ? "" : "s"}
          {fund.folio ? " from your statement" : ""}
        </summary>
        <div className="mt-3 space-y-3">
          {fund.rows.map((row, index) => (
            <div
              key={row.id}
              className="grid grid-cols-2 items-end gap-2 border-t border-ink-100 pt-3 sm:grid-cols-[8.5rem_10rem_minmax(0,1fr)_minmax(0,1fr)_9rem_2rem]"
            >
              <Field label="Type">
                <select
                  className={CONTROL}
                  value={row.side}
                  onChange={(e) => setRow(row.id, { side: e.target.value as Row["side"] })}
                  aria-label={`Row ${index + 1} type`}
                >
                  <option value="buy">Purchase</option>
                  <option value="sell">Redemption</option>
                </select>
              </Field>
              <Field label="Date">
                <input
                  className={CONTROL}
                  type="date"
                  value={row.date}
                  onChange={(e) => setRow(row.id, { date: e.target.value })}
                  aria-label={`Row ${index + 1} date`}
                />
              </Field>
              <Field label="Units">
                <input
                  className={CONTROL}
                  type="number"
                  step="any"
                  min={0}
                  inputMode="decimal"
                  value={row.units}
                  onChange={(e) => setRow(row.id, { units: e.target.value })}
                  aria-label={`Row ${index + 1} units`}
                />
              </Field>
              <Field label={row.valueKind === "nav" ? "NAV per unit" : "Amount (₹)"}>
                <input
                  className={CONTROL}
                  type="number"
                  step="any"
                  min={0}
                  inputMode="decimal"
                  value={row.value}
                  onChange={(e) => setRow(row.id, { value: e.target.value })}
                  aria-label={`Row ${index + 1} ${row.valueKind === "nav" ? "NAV" : "amount"}`}
                />
              </Field>
              <Field label="Enter as">
                <select
                  className={CONTROL}
                  value={row.valueKind}
                  onChange={(e) =>
                    setRow(row.id, { valueKind: e.target.value as Row["valueKind"] })
                  }
                  aria-label={`Row ${index + 1} value kind`}
                >
                  <option value="nav">NAV per unit</option>
                  <option value="amount">Total amount</option>
                </select>
              </Field>
              <button
                type="button"
                aria-label={`Remove row ${index + 1}`}
                title="Remove row"
                className="mb-1.5 justify-self-end rounded-full px-1.5 text-base leading-6 text-ink-500 hover:bg-ink-100 hover:text-ink-900"
                onClick={() =>
                  onChange((f) => ({ ...f, rows: f.rows.filter((r) => r.id !== row.id) }))
                }
              >
                ×
              </button>
            </div>
          ))}
        </div>
      </details>
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1">
        <button
          type="button"
          className="text-sm font-medium text-accent-600 hover:underline"
          onClick={() => onChange((f) => ({ ...f, rows: [...f.rows, newRow()] }))}
        >
          + Add a transaction
        </button>
        {incomplete ? (
          <span className="text-xs text-ink-500">
            {incomplete === 1 ? "1 row is" : `${incomplete} rows are`} incomplete and not counted.
          </span>
        ) : null}
      </div>
    </Card>
  );
}

const pct = (rate: number) => formatPercent(rate, rate === 0.125 ? 1 : 0);

function headBadge(head: TaxHead, sold: string) {
  const term = head.term === "long" ? "Long-term" : "Short-term";
  if (head.section === "pre2018") return <Badge>{term}</Badge>;
  const where =
    head.section === "slab"
      ? head.specified
        ? sectionName("50AA", sold)
        : "slab"
      : sectionName(head.section, sold);
  return (
    <Badge tone={head.term === "long" ? "good" : "neutral"}>
      {term}, {where}
      {head.rate === null ? "" : ` at ${pct(head.rate)}`}
    </Badge>
  );
}

function Results({ result, nameOf }: { result: GainsResult; nameOf: Record<string, string> }) {
  if (!result.ok) {
    return (
      <Card title="Check these entries">
        <ul className="list-disc space-y-1 pl-5 text-sm text-bad-700">
          {result.errors.map((error) => (
            <li key={error}>{error}</li>
          ))}
        </ul>
      </Card>
    );
  }
  return (
    <div className="space-y-6">
      {result.years.length ? (
        <section aria-labelledby="realised" className="space-y-4">
          <h2 id="realised" className="text-lg font-semibold tracking-tight">
            Realised gains by financial year
          </h2>
          {result.years.map((year) => (
            <YearCard key={year.fyStart} year={year} />
          ))}
          <LotsTable lots={result.realised} nameOf={nameOf} />
        </section>
      ) : null}
      <OpenLots lots={result.open} nameOf={nameOf} exemption={result.exemptionLeft} />
    </div>
  );
}

function YearCard({ year }: { year: YearSummary }) {
  const fy = `FY ${fyLabel(year.fyStart)}`;
  return (
    <Card
      title={fy}
      subtitle={
        year.covered
          ? `Sales from 1 April ${year.fyStart} to 31 March ${year.fyStart + 1}`
          : "Before FY 2018-19. Matched so later sales use the right units; tax not estimated."
      }
    >
      <div data-testid={`fy-${fyLabel(year.fyStart)}`} className="space-y-4">
        {!year.complete ? (
          <p className="text-sm text-warn-900">
            <Badge tone="warn">Incomplete</Badge> Some units bought before February 2018 need their
            31 Jan 2018 NAV. Their gains are left out until it is entered.
          </p>
        ) : null}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="Short-term gains" value={rupees(year.shortTerm)} hint="Net of losses" />
          <Stat label="Long-term gains" value={rupees(year.longTerm)} hint="Net of losses" />
          <Stat
            label="Equity LTCG exemption used"
            value={rupees(year.exemptionUsed)}
            hint={`of ${rupees(year.exemptionLimit)}`}
          />
          <Stat
            label="Estimated tax with cess"
            value={year.total === null ? "-" : rupees(year.total)}
            hint={
              !year.covered
                ? "Not estimated"
                : year.total === null
                  ? `${rupees(year.specialTax * (1 + CESS))} plus tax on slab-rate gains`
                  : undefined
            }
          />
        </div>
        {year.buckets.length ? (
          <div className="scroll-x overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className={TABLE_HEAD}>
                  <th className="hidden sm:table-cell">Taxed as</th>
                  <th className="text-right" title="After setting off losses">
                    Gain
                  </th>
                  <th className="text-right">Exempt</th>
                  <th className="text-right">Rate</th>
                  <th className="text-right">Tax</th>
                </tr>
              </thead>
              <tbody className="[&_td]:px-2 [&_td]:py-2 sm:[&_td]:px-3 [&_td.numeric]:whitespace-nowrap">
                {year.buckets.map((b) => (
                  <Fragment key={b.key}>
                    {/* On a phone the label takes its own row so the figures keep theirs. */}
                    <tr className="border-t border-ink-100 sm:hidden">
                      <td colSpan={4} className="pb-0">
                        {b.label}
                      </td>
                    </tr>
                    <tr className="sm:border-t sm:border-ink-100">
                      <td className="hidden sm:table-cell">{b.label}</td>
                      <td className="numeric text-right">{rupees(b.gain)}</td>
                      <td className="numeric text-right">{b.exempt ? rupees(b.exempt) : "-"}</td>
                      <td className="numeric text-right">
                        {b.rate === null ? "Slab" : pct(b.rate)}
                      </td>
                      <td className="numeric text-right">
                        {b.tax === null ? "Needs slab rate" : rupees(b.tax)}
                      </td>
                    </tr>
                  </Fragment>
                ))}
                {year.cess !== null ? (
                  <tr className="border-t border-ink-100">
                    <Label>Health and education cess at 4%</Label>
                    <td className="numeric text-right">{rupees(year.cess)}</td>
                  </tr>
                ) : null}
                {year.total !== null ? (
                  <tr className="border-t border-ink-200 font-semibold">
                    <Label>Estimated tax</Label>
                    <td className="numeric text-right">{rupees(year.total)}</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>
    </Card>
  );
}

/** A label across the year table's label column and all but its last figure column. */
function Label({ children }: { children: string }) {
  return (
    <>
      <td colSpan={4} className="hidden sm:table-cell">
        {children}
      </td>
      <td colSpan={3} className="sm:hidden">
        {children}
      </td>
    </>
  );
}

const TABLE_HEAD =
  "text-left text-xs text-ink-500 [&_th]:px-2 sm:[&_th]:px-3 [&_th]:pb-2 [&_th]:font-medium [&_th]:whitespace-nowrap";

function LotsTable({ lots, nameOf }: { lots: RealisedLot[]; nameOf: Record<string, string> }) {
  return (
    <Card
      title="Lot by lot"
      subtitle="Each sale split across the purchases it used up, oldest first. Cost used is after grandfathering or indexation."
    >
      <div className="scroll-x overflow-x-auto">
        <table className="min-w-full text-sm" data-testid="lots">
          <thead>
            <tr className={TABLE_HEAD}>
              <th>Fund</th>
              <th>Bought</th>
              <th>Sold</th>
              <th className="text-right">Units</th>
              <th className="text-right">Cost</th>
              <th className="text-right">Cost used</th>
              <th className="text-right">Sale value</th>
              <th className="text-right">Gain</th>
              <th>Treatment</th>
            </tr>
          </thead>
          <tbody className="[&_td]:px-2 sm:[&_td]:px-3 [&_td]:py-2 [&_td]:whitespace-nowrap">
            {lots.map((lot, i) => (
              <tr key={i} className="border-t border-ink-100">
                <td className="max-w-40 truncate sm:max-w-64" title={nameOf[lot.holdingId]}>
                  {nameOf[lot.holdingId]}
                </td>
                <td className="numeric">{lot.bought}</td>
                <td className="numeric">{lot.sold}</td>
                <td className="numeric text-right">{units(lot.units)}</td>
                <td className="numeric text-right">{rupees(lot.cost)}</td>
                <td className="numeric text-right">
                  {lot.needsNav31Jan2018 ? "Needs 31 Jan 2018 NAV" : rupees(lot.taxCost)}
                </td>
                <td className="numeric text-right">{rupees(lot.proceeds)}</td>
                <td className="numeric text-right">
                  {lot.needsNav31Jan2018 ? "-" : rupees(lot.gain)}
                </td>
                <td>{headBadge(lot.head, lot.sold)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function OpenLots({
  lots,
  nameOf,
  exemption,
}: {
  lots: OpenLot[];
  nameOf: Record<string, string>;
  exemption: { fyStart: number; limit: number; left: number };
}) {
  if (!lots.length) return null;
  return (
    <section aria-labelledby="unrealised" className="space-y-4">
      <h2 id="unrealised" className="text-lg font-semibold tracking-tight">
        Units still held
      </h2>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          label={`Equity LTCG exemption left in FY ${fyLabel(exemption.fyStart)}`}
          value={rupees(exemption.left)}
          hint={`of ${rupees(exemption.limit)}, after the sales above`}
        />
      </div>
      <Card
        title="If sold at the latest NAV"
        subtitle="The gain each lot would show at the latest published NAV, and whether it would be short or long-term. A description of the rules, not a suggestion to sell or hold."
      >
        <div className="scroll-x overflow-x-auto">
          <table className="min-w-full text-sm" data-testid="open-lots">
            <thead>
              <tr className={TABLE_HEAD}>
                <th>Fund</th>
                <th>Bought</th>
                <th className="text-right">Units</th>
                <th className="text-right">Cost</th>
                <th className="text-right">Value</th>
                <th className="text-right">Gain</th>
                <th>Today</th>
                <th>Long-term from</th>
              </tr>
            </thead>
            <tbody className="[&_td]:px-2 sm:[&_td]:px-3 [&_td]:py-2 [&_td]:whitespace-nowrap">
              {lots.map((lot, i) => (
                <tr key={i} className="border-t border-ink-100">
                  <td className="max-w-40 truncate sm:max-w-64" title={nameOf[lot.holdingId]}>
                    {nameOf[lot.holdingId]}
                  </td>
                  <td className="numeric">{lot.bought}</td>
                  <td className="numeric text-right">{units(lot.units)}</td>
                  <td className="numeric text-right">{rupees(lot.cost)}</td>
                  <td className="numeric text-right">
                    {lot.value === null ? "-" : rupees(lot.value)}
                  </td>
                  <td className="numeric text-right">
                    {lot.gain === null ? "-" : rupees(lot.gain)}
                  </td>
                  <td>{headBadge(lot.head, today())}</td>
                  <td className="numeric">
                    {lot.longTermFrom === null
                      ? "Never: always short-term"
                      : lot.head.term === "long"
                        ? "Already"
                        : lot.longTermFrom}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </section>
  );
}

function Sources() {
  return (
    <Card title="The rules applied, and where they come from">
      <ul className="space-y-3 text-sm text-ink-700">
        {SOURCES.map((source) => (
          <li key={source.rule}>
            <p>{source.rule}</p>
            <p className="mt-0.5 text-xs text-ink-500">
              {source.links.map((link, i) => (
                <span key={link.href}>
                  {i ? " · " : ""}
                  <a
                    className="underline hover:text-accent-600"
                    href={link.href}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {link.label}
                  </a>
                </span>
              ))}
            </p>
          </li>
        ))}
      </ul>
    </Card>
  );
}
