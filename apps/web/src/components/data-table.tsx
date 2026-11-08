"use client";

import type { MetricSpec, ScreenRow } from "@mf/shared";
import { flexRender, getCoreRowModel, useReactTable, type ColumnDef } from "@tanstack/react-table";
import { useEffect, useMemo, useRef } from "react";
import Link from "@/components/link";
import { useI18n } from "@/lib/i18n/client";
import type { Messages } from "@/messages/en";
import { MetricHeader, MetricValue } from "./metric-cell";

// The pinned name column: narrow on a phone so the figures scrolled beside it stay readable,
// with long names clamped to three lines (the full name is the link's tooltip).
const NAME_COLUMN = "w-38 min-w-38 max-w-38 sm:w-[280px] sm:min-w-[280px] sm:max-w-[280px]";

// The non-metric columns. Metric headers get their plain label from the API's
// catalogue; these have no spec, so their wording lives in the site's.
export const textLabel = (t: Messages, name: string): string | undefined =>
  Object.hasOwn(t.table.columns, name)
    ? t.table.columns[name as keyof Messages["table"]["columns"]]
    : undefined;

const HIDDEN_COLUMNS = new Set(["missing_reasons"]);

export type DataTableProps = {
  rows: ScreenRow[];
  columns: string[];
  metrics: Record<string, MetricSpec>;
  reasonDescriptions: Record<string, string>;
  sort: string;
  onSort: (column: string, additive: boolean) => void;
  sortable: Set<string>;
  selected?: Set<string>;
  onToggleSelect?: (code: string) => void;
};

/**
 * Keeps the scroll region's bottom edge - and with it the horizontal scrollbar - inside the
 * viewport at every page scroll position. A fixed max-height cannot: the region starts lower
 * on the page when a banner or a filter summary is showing, and a bar below the fold is a bar
 * nobody drags.
 */
function useFittedToViewport() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const fit = () => {
      const top = Math.max(element.getBoundingClientRect().top, 0);
      // Rows below this get so few that paging beats scrolling; the bar stays reachable anyway.
      element.style.maxHeight = `${Math.max(window.innerHeight - top - 24, 240)}px`;
    };
    fit();
    window.addEventListener("scroll", fit, { passive: true });
    window.addEventListener("resize", fit);
    return () => {
      window.removeEventListener("scroll", fit);
      window.removeEventListener("resize", fit);
    };
  }, []);
  return ref;
}

function reasonFor(row: ScreenRow, column: string): string | undefined {
  const reasons = row["missing_reasons"];
  if (reasons && typeof reasons === "object") {
    const value = (reasons as Record<string, unknown>)[column];
    if (typeof value === "string") return value;
  }
  return undefined;
}

export function DataTable({
  rows,
  columns,
  metrics,
  reasonDescriptions,
  sort,
  onSort,
  sortable,
  selected,
  onToggleSelect,
}: DataTableProps) {
  const { t, td } = useI18n();
  const visible = useMemo(() => columns.filter((c) => !HIDDEN_COLUMNS.has(c)), [columns]);
  const scroller = useFittedToViewport();

  const columnDefs = useMemo<ColumnDef<ScreenRow>[]>(
    () =>
      visible.map((name) => ({
        id: name,
        accessorFn: (row) => row[name],
        header: () =>
          metrics[name] ? (
            <MetricHeader spec={metrics[name]} name={name} />
          ) : (
            <span>{textLabel(t, name) ?? name}</span>
          ),
        cell: (ctx) => {
          const row = ctx.row.original;
          const value = ctx.getValue();
          if (name === "scheme_name") {
            return (
              <Link
                href={`/fund/${String(row["scheme_code"])}`}
                title={String(value ?? "")}
                className="line-clamp-3 text-xs font-medium text-ink-900 hover:text-accent-600 hover:underline sm:line-clamp-none sm:text-sm"
              >
                {String(value ?? "")}
              </Link>
            );
          }
          if (name === "data_quality_flags") {
            const flags = Array.isArray(value) ? (value as string[]) : [];
            if (!flags.length) return <span className="text-ink-300">-</span>;
            return (
              <span className="flex flex-wrap gap-1">
                {flags.map((flag) => (
                  <span
                    key={flag}
                    className="rounded bg-warn-100 px-1 py-0.5 text-[10px] text-warn-900"
                  >
                    {td(flag.replaceAll("_", " "))}
                  </span>
                ))}
              </span>
            );
          }
          const reason = reasonFor(row, name);
          return (
            <MetricValue
              value={value}
              spec={metrics[name]}
              reason={reason}
              reasonDescription={reason ? reasonDescriptions[reason] : undefined}
            />
          );
        },
      })),
    [visible, metrics, reasonDescriptions, t, td],
  );

  // TanStack Table's API cannot be memoised by the React Compiler, which is not in use.
  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    data: rows,
    columns: columnDefs,
    getCoreRowModel: getCoreRowModel(),
  });

  const sortTokens = new Map(
    sort
      .split(",")
      .filter(Boolean)
      .map((token, index) => {
        const [name, direction] = token.split(":");
        return [name ?? "", { direction: direction ?? "desc", index: index + 1 }] as const;
      }),
  );

  return (
    <div
      ref={scroller}
      // A scroll region a mouse can only reach by dragging a hairline overlay bar is one
      // most people never find, so it is focusable: arrow keys scroll it once tabbed to.
      role="region"
      aria-label={t.table.region}
      tabIndex={0}
      // `relative` makes this the containing block for the sticky cells; without it their
      // layout overflow escapes onto the root document and the whole page scrolls sideways.
      // Height is capped to the viewport (see the hook), so the sideways scrollbar stays on
      // screen instead of sitting below fifty rows; rows scroll under the pinned header.
      className="scroll-x @container relative overflow-auto rounded-xl border border-ink-200 bg-surface shadow-card focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-500"
    >
      <table className="min-w-full border-collapse text-sm">
        <thead>
          {table.getHeaderGroups().map((group) => (
            <tr key={group.id}>
              {onToggleSelect ? (
                // The pinned column next to this one is offset by exactly 40px, so this has to
                // hold that width; under auto layout a width alone settles at 37px.
                <th className="sticky top-0 left-0 z-30 w-10 max-w-10 min-w-10 border-b border-ink-200 bg-ink-50 px-3 py-2" />
              ) : null}
              {group.headers.map((header, index) => {
                const name = header.column.id;
                const active = sortTokens.get(name);
                const isSticky = index === 0;
                return (
                  <th
                    key={header.id}
                    scope="col"
                    aria-sort={
                      active ? (active.direction === "asc" ? "ascending" : "descending") : "none"
                    }
                    className={`sticky top-0 z-20 border-b border-ink-200 bg-ink-50 px-3 py-2.5 text-left align-bottom text-xs font-medium whitespace-nowrap text-ink-500 ${
                      isSticky
                        ? `${onToggleSelect ? "left-10" : "left-0"} z-30 ${NAME_COLUMN} border-r border-ink-200`
                        : ""
                    }`}
                  >
                    <span className="flex items-center gap-1">
                      {flexRender(header.column.columnDef.header, header.getContext())}
                      {sortable.has(name) ? (
                        <button
                          type="button"
                          onClick={(event) => onSort(name, event.shiftKey)}
                          aria-label={t.table.sortBy(
                            td(metrics[name]?.plain_label || metrics[name]?.label || "") ||
                              textLabel(t, name) ||
                              name,
                          )}
                          className="rounded px-1 text-ink-500 hover:bg-ink-200"
                          title={t.table.sortHint}
                        >
                          {active ? (
                            <span className="numeric">
                              {active.direction === "asc" ? "↑" : "↓"}
                              {sortTokens.size > 1 ? active.index : ""}
                            </span>
                          ) : (
                            "↕"
                          )}
                        </button>
                      ) : null}
                    </span>
                  </th>
                );
              })}
            </tr>
          ))}
        </thead>
        <tbody>
          {table.getRowModel().rows.map((row) => {
            const code = String(row.original["scheme_code"]);
            return (
              // The pinned cells inherit this background, so every state of it has to be
              // opaque or the scrolling columns show through them.
              <tr key={row.id} className="bg-surface hover:bg-accent-50">
                {onToggleSelect ? (
                  <td className="sticky left-0 z-10 w-10 max-w-10 min-w-10 border-b border-ink-100 bg-inherit px-3 py-2.5">
                    <input
                      type="checkbox"
                      aria-label={t.table.select(String(row.original["scheme_name"] ?? code))}
                      checked={selected?.has(code) ?? false}
                      onChange={() => onToggleSelect(code)}
                    />
                  </td>
                ) : null}
                {row.getVisibleCells().map((cell, index) => (
                  <td
                    key={cell.id}
                    // Only the pinned cell wraps. Listing both whitespace utilities on one
                    // element would leave the winner to stylesheet order, not class order.
                    className={
                      index === 0
                        ? `sticky ${onToggleSelect ? "left-10" : "left-0"} z-10 ${NAME_COLUMN} border-r border-b border-ink-200 border-b-ink-100 bg-inherit px-3 py-2.5 whitespace-normal`
                        : "border-b border-ink-100 px-3 py-2.5 whitespace-nowrap"
                    }
                  >
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            );
          })}
          {rows.length === 0 ? (
            <tr>
              <td
                colSpan={visible.length + (onToggleSelect ? 1 : 0)}
                className="py-10 text-center text-sm text-ink-500"
              >
                {/* Centred in the visible width, not the table's, which on a phone is
                    mostly scrolled off to the right. */}
                <p className="sticky left-0 w-[100cqw] px-3">{t.table.empty}</p>
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}
