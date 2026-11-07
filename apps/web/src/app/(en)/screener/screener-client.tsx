"use client";

import {
  formatPercent,
  type ColumnsResponse,
  type Facets,
  type MetricSpec,
  type Preset,
  type ScreenResponse,
} from "@mf/shared";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ColumnPicker } from "@/components/column-picker";
import Link from "@/components/link";
import { DataTable } from "@/components/data-table";
import { FilterDrawer } from "@/components/filter-drawer";
import { Button, Card, inputClass } from "@/components/ui";
import { exportCsv, getScreen } from "@/lib/api";
import { useI18n } from "@/lib/i18n/client";
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
  const { t, td, number } = useI18n();
  const s = t.screener;
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
    () =>
      describeSort(
        filters.sort,
        (c) => {
          const label = metrics[c]?.plain_label || metrics[c]?.label;
          return label && td(label);
        },
        s.sort,
      ),
    [filters.sort, metrics, td, s.sort],
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
      <p className="text-sm text-ink-500">
        {loading ? t.common.loading : s.matches(data?.total ?? 0, number(data?.total ?? 0))} ·{" "}
        <span title={filters.sort}>{s.sortedBy(sortDescription)}</span>
        {universeTotal !== null && data
          ? ` · ${s.clearRules(number(data.total), number(universeTotal), activeRangeCount)}`
          : null}
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <input
          className={`${inputClass} w-full sm:w-72`}
          placeholder={s.search}
          value={searchDraft}
          onChange={(e) => setSearchDraft(e.target.value)}
          aria-label={s.search}
        />
        <select
          className={`${inputClass} w-full sm:w-auto sm:max-w-sm`}
          aria-label={s.preset}
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
          <option value="">{s.applyPreset}</option>
          {presets.map((preset) => (
            <option key={preset.id} value={preset.id}>
              {td(preset.name)}
            </option>
          ))}
        </select>
        <span className="hidden grow sm:block" />
        <Button onClick={() => setShowFilters(true)}>
          {t.filters.title}
          {activeRangeCount ? ` (${activeRangeCount})` : ""}
        </Button>
        {onStarterColumns ? (
          <Button
            onClick={() => setFilters({ ...filters, columns: columnsMeta.default, page: 1 })}
            title={s.advancedHint}
          >
            {s.advanced}
          </Button>
        ) : null}
        <Button onClick={() => setShowColumns(true)}>
          {s.columns(filters.columns.length, onStarterColumns)}
        </Button>
        <Button disabled={exporting} onClick={downloadCsv}>
          {exporting ? s.exporting : s.export}
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs text-ink-500">
        {selected.size ? (
          <Link
            className="rounded-full bg-accent-500 px-3 py-1 font-medium text-on-accent"
            href={`/compare?codes=${[...selected].join(",")}`}
          >
            {s.compareSelected(selected.size)}
          </Link>
        ) : (
          <span>{s.selectToCompare}</span>
        )}
        <button
          className="rounded-full border border-ink-200 bg-surface px-3 py-1 text-ink-700 hover:border-ink-300"
          onClick={() => {
            const name = window.prompt(s.nameScreen);
            if (name) setSaved(saveScreen(name, filters));
          }}
        >
          {s.save}
        </button>
        {saved.map((screen) => (
          <span
            key={screen.name}
            className="inline-flex items-center gap-1.5 rounded-full bg-ink-100 px-3 py-1 text-ink-700"
          >
            <button onClick={() => setFilters(screen.filters)}>{screen.name}</button>
            <button
              aria-label={s.deleteSaved(screen.name)}
              onClick={() => setSaved(deleteScreen(screen.name))}
              className="text-ink-500"
            >
              ×
            </button>
          </span>
        ))}
      </div>

      {appliedPreset ? (
        <section className="rounded-xl border border-accent-500/25 bg-accent-50 p-4">
          <h2 className="text-sm font-semibold">{td(appliedPreset.name)}</h2>
          <p className="mt-1 text-sm text-ink-700">{td(appliedPreset.plain_description)}</p>
          <p className="mt-2 text-xs text-ink-500">{td(appliedPreset.caution)}</p>
        </section>
      ) : null}

      {alphaFilterActive && alphaCaveat ? (
        <p className="text-xs text-ink-500">{td(alphaCaveat)}</p>
      ) : null}

      {categoryAverageShown ? <p className="text-xs text-ink-500">{s.survivorship}</p> : null}

      {error ? (
        <Card>
          <p className="text-sm text-bad-700">{td(error)}</p>
          <p className="mt-2 text-xs text-ink-500">{s.errorHint}</p>
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

          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span className="text-ink-500">{s.page(data.page, Math.max(data.pages, 1))}</span>
            <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
              <select
                className={`${inputClass} w-28`}
                aria-label={s.rowsPerPage}
                value={filters.pageSize}
                onChange={(e) =>
                  setFilters((f) => ({ ...f, pageSize: Number(e.target.value), page: 1 }))
                }
              >
                {[25, 50, 100, 200].map((size) => (
                  <option key={size} value={size}>
                    {s.rows(size)}
                  </option>
                ))}
              </select>
              <Button
                disabled={data.page <= 1}
                onClick={() => setFilters((f) => ({ ...f, page: f.page - 1 }))}
              >
                {s.previous}
              </Button>
              <Button
                disabled={data.page >= data.pages}
                onClick={() => setFilters((f) => ({ ...f, page: f.page + 1 }))}
              >
                {s.next}
              </Button>
            </div>
          </div>

          <Card title={s.methodology}>
            <ul className="space-y-1 text-xs text-ink-700">
              <li>{s.metricsAsOf(data.methodology.as_of ?? "-", data.methodology.version)}</li>
              <li>{s.peerUniverse(data.methodology.peer_universe)}</li>
              <li>{s.riskFree(formatPercent(data.methodology.risk_free_annual))}</li>
              <li>{td(data.methodology.note)}</li>
              <li className="text-ink-500">{td(data.methodology.disclaimer)}</li>
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
