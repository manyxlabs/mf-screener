"use client";

import { useId, useState, type ReactNode } from "react";

/**
 * Hover and focus both open it, and the panel is described by the trigger, so the
 * explanation is reachable by keyboard rather than mouse-only.
 */
export function InfoTooltip({
  children,
  label,
  align = "left",
}: {
  children: ReactNode;
  label: ReactNode;
  align?: "left" | "right";
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <span className="relative inline-flex">
      <button
        type="button"
        aria-describedby={open ? id : undefined}
        aria-label="Explain this metric"
        className="cursor-help text-left"
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onClick={() => setOpen((v) => !v)}
      >
        {label}
      </button>
      {open ? (
        <span
          id={id}
          role="tooltip"
          // `whitespace-normal` undoes the nowrap that table headers set: without it the
          // text runs straight out of the panel and over the rows behind it.
          className={`absolute top-full z-30 mt-1 w-72 rounded-md border border-ink-300 bg-surface p-3 text-xs leading-relaxed font-normal whitespace-normal text-ink-700 shadow-lg ${
            align === "right" ? "right-0" : "left-0"
          }`}
        >
          {children}
        </span>
      ) : null}
    </span>
  );
}
