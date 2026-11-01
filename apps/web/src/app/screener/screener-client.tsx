"use client";

import type { ColumnsResponse, Facets, MetricSpec, Preset, ScreenResponse } from "@mf/shared";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ColumnPicker } from "@/components/column-picker";
import { DataTable } from "@/components/data-table";
import { FilterDrawer } from "@/components/filter-drawer";
import { Button, Card, inputClass } from "@/components/ui";
import { exportCsv, getScreen } from "@/lib/api";
import {
  DEFAULT_FILTERS,
  describeSort,
  matchesPreset,
  presetToFilters,
  toQueryString,
  toggleSort,
  type ScreenFilters,
} from "@/lib/screen-query";
import { deleteScreen, loadSavedScreens, saveScreen, type SavedScreen } from "@/lib/saved-screens";

// Any column whose value is itself a category average, or is measured against one.
// T2.4: wherever one of these is on screen, the survivorship caveat belongs next to it.
const CATEGORY_AVERAGE_COLUMN =
  /^(category_return_|fund_minus_category_|fund_div_category_|rolling_\d+y_beat_category_pct)/;

export function ScreenerClient({
  columnsMeta,
  presets,
  facets,
}: {
  columnsMeta: ColumnsResponse;
  presets: Preset[];
  facets: Facets;
}) {
  const searchParams = useSearchParams();
  const metrics = useMemo(
    () =>
      Object.fromEntries(columnsMeta.metrics.map((m) => [m.name, m])) as Record<string, MetricSpec>,
    [columnsMeta.metrics],
  );
  const sortable = useMemo(() => new Set(columnsMeta.sortable), [columnsMeta.sortable]);

  const [filters, setFilters] = useState<ScreenFilters>(() => {
    const presetId = searchParams.get("preset");
    const preset = presets.find((p) => p.id === presetId);
    // A preset brings its own column list. Without one, a first visit opens on the
    // eight-column starter set rather than the 34-column standard one.
    const base: ScreenFilters = { ...DEFAULT_FILTERS, columns: columnsMeta.default };
    if (preset) return presetToFilters(preset, base);
    if (!searchParams.get("columns")) base.columns = columnsMeta.starter;
    const sub = searchParams.get("sub_category");
    const search = searchParams.get("search");
    return {
      ...base,
      subCategories: sub ? [sub] : [],
      search: search ?? "",
    };
  });

  const [data, setData] = useState<ScreenResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showFilters, setShowFilters] = useState(false);
  const [showColumns, setShowColumns] = useState(false);
  const [saved, setSaved] = useState<SavedScreen[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [searchDraft, setSearchDraft] = useState(filters.search);
  const onStarterColumns = useMemo(
    () =>
      filters.columns.length === columnsMeta.starter.length &&
      filters.columns.every((c, i) => c === columnsMeta.starter[i]),
    [filters.columns, columnsMeta.starter],
  );
  const sortDescription = useMemo(
    () => describeSort(filters.sort, (c) => metrics[c]?.plain_label || metrics[c]?.label),
    [filters.sort, metrics],
  );

  useEffect(() => setSaved(loadSavedScreens()), []);

  useEffect(() => {
    const timer = setTimeout(
      () =>
        setFilters((f) => (f.search === searchDraft ? f : { ...f, search: searchDraft, page: 1 })),
      300,
    );
    return () => clearTimeout(timer);
  }, [searchDraft]);

  const query = useMemo(() => toQueryString(filters), [filters]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getScreen(query)
      .then((response) => {
        if (cancelled) return;
        setData(response);
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
  }, [query]);

  const categoryAverageShown = filters.columns.some((c) => CATEGORY_AVERAGE_COLUMN.test(c));

  const [exporting, setExporting] = useState(false);
  const downloadCsv = async () => {
    setExporting(true);
    try {
      const csv = await exportCsv(toQueryString(filters, { omitPaging: true }));
      const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
      const link = Object.assign(document.createElement("a"), {
        href: url,
        download: "mf-screen.csv",
      });
      link.click();
      // Revoked on the next tick: some browsers resolve the URL after click() returns.
      setTimeout(() => URL.revokeObjectURL(url));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setExporting(false);
    }
  };

  const onSort = useCallback((column: string, additive: boolean) => {
    setFilters((f) => ({ ...f, sort: toggleSort(f.sort, column, additive), page: 1 }));
  }, []);

  const toggleSelect = useCallback((code: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(code)) next.delete(code);
      else if (next.size < 5) next.add(code);
      return next;
    });
  }, []);

  const activeRangeCount = Object.keys(filters.ranges).length;
  const appliedPreset = useMemo(
    () => presets.find((preset) => matchesPreset(preset, filters)),
    [presets, filters],
  );

  // A preset can hide half a dozen thresholds behind one dropdown, and a screen that
  // answers "12 funds" without saying 12 of how many reads as a bug in the data.
  const [universeTotal, setUniverseTotal] = useState<number | null>(null);
  const universeQuery = useMemo(
    () =>
      activeRangeCount
        ? toQueryString({ ...filters, ranges: {}, page: 1, pageSize: 1, columns: [] })
        : null,
    [filters, activeRangeCount],
  );

  useEffect(() => {
    if (!universeQuery) {
      setUniverseTotal(null);
      return;
    }
    let cancelled = false;
    getScreen(universeQuery)
      .then((response) => !cancelled && setUniverseTotal(response.total))
      .catch(() => !cancelled && setUniverseTotal(null));
    return () => {
      cancelled = true;
    };
  }, [universeQuery]);
  // Alpha screened across the whole universe without a correction is a
  // multiple-comparisons machine: surface the caveat whenever an alpha-related
  // filter is actually set, not just while the filter drawer happens to be open.
  const alphaFilterActive = Object.keys(filters.ranges).some(
    (key) => key.startsWith("alpha_") && (key.endsWith("_min") || key.endsWith("_max")),
  );
  const alphaCaveat = metrics.alpha_pvalue_5y?.caveat ?? metrics.alpha_tstat_5y?.caveat;

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-lg font-semibold tracking-tight">Screener</h1>
        <input
          className={`${inputClass} w-72`}
          placeholder="Search fund or AMC"
          value={searchDraft}
          onChange={(e) => setSearchDraft(e.target.value)}
          aria-label="Search fund or AMC"
        />
        <select
          className={`${inputClass} w-56`}
          aria-label="Preset screen"
          value={appliedPreset?.id ?? ""}
          onChange={(e) => {
            const preset = presets.find((p) => p.id === e.target.value);
            if (preset) {
              setFilters(
                presetToFilters(preset, { ...DEFAULT_FILTERS, columns: columnsMeta.default }),
              );
              setSearchDraft(preset.filters.search ?? "");
            }
          }}
        >
          <option value="">Apply a preset...</option>
          {presets.map((preset) => (
            <option key={preset.id} value={preset.id}>
              {preset.name}
            </option>
          ))}
        </select>
        <Button onClick={() => setShowFilters(true)}>
          Filters{activeRangeCount ? ` (${activeRangeCount})` : ""}
        </Button>
        {onStarterColumns ? (
          <Button
            onClick={() => setFilters({ ...filters, columns: columnsMeta.default, page: 1 })}
            title="Switch to the fuller standard column set"
          >
            Show advanced columns
          </Button>
        ) : null}
        <Button onClick={() => setShowColumns(true)}>
          Columns ({filters.columns.length}
          {onStarterColumns ? " · starter" : ""})
        </Button>
        <Button disabled={exporting} onClick={downloadCsv}>
          {exporting ? "Exporting..." : "Export CSV"}
        </Button>
      </header>

      <div className="flex flex-wrap items-center gap-2 text-xs text-ink-500">
        <span>
          {loading
            ? "Loading..."
            : `${data?.total ?? 0} ${data?.total === 1 ? "fund matches" : "funds match"}`}{" "}
          · <span title={filters.sort}>sorted by {sortDescription}</span>
        </span>
        {universeTotal !== null && data ? (
          <span>
            {`· ${data.total} of the ${universeTotal} funds in this universe clear the `}
            {activeRangeCount === 1 ? "numeric rule" : `${activeRangeCount} numeric rules`}
            {`; the rest fall short of one or have no value for it.`}
          </span>
        ) : null}
        {selected.size ? (
          <Link
            className="rounded border border-accent-500 px-2 py-0.5 text-accent-600"
            href={`/compare?codes=${[...selected].join(",")}`}
          >
            Compare {selected.size} selected
          </Link>
        ) : (
          <span>Select up to five funds to compare.</span>
        )}
        <button
          className="rounded border border-ink-300 px-2 py-0.5"
          onClick={() => {
            const name = window.prompt("Name this screen");
            if (name) setSaved(saveScreen(name, filters));
          }}
        >
          Save this screen
        </button>
        {saved.map((screen) => (
          <span
            key={screen.name}
            className="inline-flex items-center gap-1 rounded bg-ink-100 px-2 py-0.5"
          >
            <button onClick={() => setFilters(screen.filters)}>{screen.name}</button>
            <button
              aria-label={`Delete saved screen ${screen.name}`}
              onClick={() => setSaved(deleteScreen(screen.name))}
              className="text-ink-500"
            >
              ×
            </button>
          </span>
        ))}
      </div>

      {appliedPreset ? (
        <section className="rounded-lg border border-ink-200 bg-surface p-3">
          <h2 className="text-sm font-semibold">{appliedPreset.name}</h2>
          <p className="mt-1 text-sm text-ink-700">{appliedPreset.plain_description}</p>
          <p className="mt-1 text-xs text-ink-500">{appliedPreset.caution}</p>
        </section>
      ) : null}

      {alphaFilterActive && alphaCaveat ? (
        <p className="text-xs text-ink-500">{alphaCaveat}</p>
      ) : null}

      {categoryAverageShown ? (
        <p className="text-xs text-ink-500">
          Category averages above are active-only and do not include funds that closed or merged,
          which flatters them (survivorship bias). The methodology page explains how that gap is
          measured.
        </p>
      ) : null}

      {error ? (
        <Card>
          <p className="text-sm text-bad-700">{error}</p>
          <p className="mt-2 text-xs text-ink-500">
            If this is a filter error, clear the offending range in the filter drawer.
          </p>
        </Card>
      ) : null}

      {data ? (
        <>
          <DataTable
            rows={data.rows}
            columns={data.columns}
            metrics={metrics}
            reasonDescriptions={columnsMeta.missing_reasons}
            sort={filters.sort}
            onSort={onSort}
            sortable={sortable}
            selected={selected}
            onToggleSelect={toggleSelect}
          />

          <div className="flex items-center justify-between text-sm">
            <span className="text-ink-500">
              Page {data.page} of {Math.max(data.pages, 1)}
            </span>
            <div className="flex items-center gap-2">
              <select
                className={`${inputClass} w-28`}
                aria-label="Rows per page"
                value={filters.pageSize}
                onChange={(e) =>
                  setFilters((f) => ({ ...f, pageSize: Number(e.target.value), page: 1 }))
                }
              >
                {[25, 50, 100, 200].map((size) => (
                  <option key={size} value={size}>
                    {size} rows
                  </option>
                ))}
              </select>
              <Button
                disabled={data.page <= 1}
                onClick={() => setFilters((f) => ({ ...f, page: f.page - 1 }))}
              >
                Previous
              </Button>
              <Button
                disabled={data.page >= data.pages}
                onClick={() => setFilters((f) => ({ ...f, page: f.page + 1 }))}
              >
                Next
              </Button>
            </div>
          </div>

          <Card title="Methodology applied to this screen">
            <ul className="space-y-1 text-xs text-ink-700">
              <li>
                Metrics as of {data.methodology.as_of ?? "-"} (v{data.methodology.version})
              </li>
              <li>
                Peer universe: {data.methodology.peer_universe.plan_scope} plans,{" "}
                {data.methodology.peer_universe.option_scope} option,{" "}
                {data.methodology.peer_universe.active_only ? "active only" : "all schemes"},{" "}
                {data.methodology.peer_universe.aggregation} of at least{" "}
                {data.methodology.peer_universe.min_peers} peers,{" "}
                {data.methodology.peer_universe.exclude_self ? "excluding" : "including"} the fund
                itself
              </li>
              <li>
                Risk-free rate: {(data.methodology.risk_free_annual * 100).toFixed(2)}% annual
              </li>
              <li>{data.methodology.note}</li>
              <li className="text-ink-500">{data.methodology.disclaimer}</li>
            </ul>
          </Card>
        </>
      ) : null}

      <FilterDrawer
        open={showFilters}
        onClose={() => setShowFilters(false)}
        filters={filters}
        onChange={setFilters}
        metrics={metrics}
        facets={facets}
      />
      <ColumnPicker
        open={showColumns}
        onClose={() => setShowColumns(false)}
        selectable={columnsMeta.selectable}
        selected={filters.columns}
        metrics={metrics}
        defaults={columnsMeta.default}
        starter={columnsMeta.starter}
        onChange={(columns) => setFilters((f) => ({ ...f, columns }))}
      />
    </div>
  );
}
