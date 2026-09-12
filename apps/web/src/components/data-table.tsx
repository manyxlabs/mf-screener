"use client";

import type { MetricSpec, ScreenRow } from "@mf/shared";
import { flexRender, getCoreRowModel, useReactTable, type ColumnDef } from "@tanstack/react-table";
import Link from "next/link";
import { useMemo } from "react";
import { MetricHeader, MetricValue } from "./metric-cell";

const TEXT_LABELS: Record<string, string> = {
  scheme_code: "Code",
  scheme_name: "Fund",
  amc: "AMC",
  clean_category: "Category",
  clean_sub_category: "Sub-category",
  clean_plan: "Plan",
  clean_option: "Option",
  benchmark_id: "Benchmark",
  is_active: "Active",
  first_nav_date: "First NAV",
  last_nav_date: "Last NAV",
  latest_nav_date: "NAV date",
  aum_quarter: "AUM quarter",
  data_quality_flags: "Flags",
};

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
  const visible = useMemo(() => columns.filter((c) => !HIDDEN_COLUMNS.has(c)), [columns]);

  const columnDefs = useMemo<ColumnDef<ScreenRow>[]>(
    () =>
      visible.map((name) => ({
        id: name,
        accessorFn: (row) => row[name],
        header: () =>
          metrics[name] ? (
            <MetricHeader spec={metrics[name]} name={name} />
          ) : (
            <span>{TEXT_LABELS[name] ?? name}</span>
          ),
        cell: (ctx) => {
          const row = ctx.row.original;
          const value = ctx.getValue();
          if (name === "scheme_name") {
            return (
              <Link
                href={`/fund/${String(row["scheme_code"])}`}
                className="text-accent-600 hover:underline"
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
                    {flag.replaceAll("_", " ")}
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
    [visible, metrics, reasonDescriptions],
  );

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
      // `relative` makes this the containing block for the sticky cells; without it their
      // layout overflow escapes onto the root document and the whole page scrolls sideways.
      className="relative overflow-x-auto rounded-lg border border-ink-200 bg-surface"
    >
      <table className="min-w-full border-collapse text-sm">
        <thead className="bg-ink-50">
          {table.getHeaderGroups().map((group) => (
            <tr key={group.id}>
              {onToggleSelect ? (
                // The pinned column next to this one is offset by exactly 40px, so this has to
                // hold that width; under auto layout a width alone settles at 37px.
                <th className="sticky left-0 z-20 w-10 max-w-10 min-w-10 border-b border-ink-200 bg-ink-50 px-3 py-2" />
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
                    className={`whitespace-nowrap border-b border-ink-200 px-3 py-2 text-left align-bottom text-xs font-semibold text-ink-700 ${
                      isSticky
                        ? `sticky ${onToggleSelect ? "left-10" : "left-0"} z-20 w-[280px] min-w-[280px] max-w-[280px] border-r border-ink-200 bg-ink-50`
                        : ""
                    }`}
                  >
                    <span className="flex items-center gap-1">
                      {flexRender(header.column.columnDef.header, header.getContext())}
                      {sortable.has(name) ? (
                        <button
                          type="button"
                          onClick={(event) => onSort(name, event.shiftKey)}
                          className="rounded px-1 text-ink-500 hover:bg-ink-200"
                          title="Sort. Hold shift to add a secondary sort."
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
              <tr key={row.id} className="bg-surface even:bg-ink-50 hover:bg-accent-50">
                {onToggleSelect ? (
                  <td className="sticky left-0 z-10 w-10 max-w-10 min-w-10 border-b border-ink-100 bg-inherit px-3 py-1.5">
                    <input
                      type="checkbox"
                      aria-label={`Select ${String(row.original["scheme_name"] ?? code)}`}
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
                        ? `sticky ${onToggleSelect ? "left-10" : "left-0"} z-10 w-[280px] min-w-[280px] max-w-[280px] border-r border-b border-ink-200 border-b-ink-100 bg-inherit px-3 py-1.5 whitespace-normal`
                        : "border-b border-ink-100 px-3 py-1.5 whitespace-nowrap"
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
                className="px-3 py-10 text-center text-sm text-ink-500"
              >
                No funds match these filters. Loosen a range, or widen the plan/option universe.
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}
