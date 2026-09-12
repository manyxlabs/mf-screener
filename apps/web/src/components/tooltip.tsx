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
    // The pointer handlers sit on the wrapper, not the trigger, so moving into the
    // panel does not close it. The panel is a DOM descendant, so it counts as inside.
    // Anything interactive in `children` depends on this.
    <span
      className="relative inline-flex"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      // React's onBlur bubbles where the native event does not, so this fires for the
      // trigger and for anything focusable inside the panel. Closing only once focus
      // has left the whole wrapper is what lets a keyboard reach a link in there.
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOpen(false);
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") setOpen(false);
      }}
    >
      <button
        type="button"
        aria-describedby={open ? id : undefined}
        aria-label="Explain this metric"
        className="cursor-help text-left"
        onClick={() => setOpen((v) => !v)}
      >
        {label}
      </button>
      {open ? (
        // Padding rather than a margin: a 4px gap between trigger and panel is 4px of
        // not-hovering-either, which would close the panel on the way to it.
        <span className={`absolute top-full z-30 pt-1 ${align === "right" ? "right-0" : "left-0"}`}>
          <span
            id={id}
            role="tooltip"
            // `whitespace-normal` undoes the nowrap that table headers set: without it the
            // text runs straight out of the panel and over the rows behind it.
            className="block w-72 rounded-md border border-ink-300 bg-surface p-3 text-xs leading-relaxed font-normal whitespace-normal text-ink-700 shadow-lg"
          >
            {children}
          </span>
        </span>
      ) : null}
    </span>
  );
}
