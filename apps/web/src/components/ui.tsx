import type { ReactNode } from "react";
import { InfoTooltip } from "./tooltip";

export function Card({
  title,
  subtitle,
  children,
  className = "",
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-lg border border-ink-200 bg-surface p-4 ${className}`}>
      {title ? (
        <header className="mb-3">
          <h2 className="text-sm font-semibold text-ink-900">{title}</h2>
          {subtitle ? <p className="mt-0.5 text-xs text-ink-500">{subtitle}</p> : null}
        </header>
      ) : null}
      {children}
    </section>
  );
}

export function Stat({
  label,
  value,
  hint,
  tooltip,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tooltip?: ReactNode;
}) {
  // Two lines' worth of room whether or not this tile's label needs it, so a long
  // label does not push its own value row out of line with the tiles beside it.
  const labelClass = "flex min-h-[2.4em] text-[11px] uppercase tracking-wide text-ink-500";
  return (
    <div className="rounded-md border border-ink-200 bg-surface px-3 py-2.5">
      <div className={labelClass}>
        {tooltip ? (
          <InfoTooltip label={<span className="underline decoration-dotted">{label}</span>}>
            {tooltip}
          </InfoTooltip>
        ) : (
          label
        )}
      </div>
      <div className="mt-1 text-lg font-semibold numeric">{value}</div>
      {hint ? <div className="mt-0.5 text-[11px] text-ink-500">{hint}</div> : null}
    </div>
  );
}

export function Button({
  children,
  variant = "secondary",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost";
}) {
  const styles = {
    primary: "bg-accent-500 text-on-accent hover:bg-accent-600 border-accent-500",
    secondary: "bg-surface text-ink-900 hover:bg-ink-100 border-ink-300",
    ghost: "bg-transparent text-ink-700 hover:bg-ink-100 border-transparent",
  }[variant];
  return (
    <button
      {...props}
      className={`rounded-md border px-3 py-1.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${styles} ${props.className ?? ""}`}
    >
      {children}
    </button>
  );
}

export function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "warn" | "good" | "bad";
}) {
  const styles = {
    neutral: "bg-ink-100 text-ink-700",
    warn: "bg-warn-100 text-warn-900",
    good: "bg-good-100 text-good-900",
    bad: "bg-bad-100 text-bad-900",
  }[tone];
  return (
    <span className={`inline-block rounded px-1.5 py-0.5 text-[11px] font-medium ${styles}`}>
      {children}
    </span>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-ink-500">
        {label}
      </span>
      {children}
    </label>
  );
}

// Width is the caller's: two width utilities in one class string resolve by stylesheet
// order, not by the order they are written, so this must not ship one of its own.
export const inputClass =
  "rounded-md border border-ink-300 bg-surface px-2.5 py-1.5 text-sm outline-none focus:border-accent-500";

/**
 * A percent field that reads and writes whole percents while the filter state, the
 * query string and the API all keep the decimal they already agree on. The screener
 * used to ask for `0.12` and explain itself in hint text.
 *
 * `value` and `onChange` are in decimals; only what the user sees is scaled.
 */
export function PercentInput({
  value,
  onChange,
  placeholder,
  ariaLabel,
  className = "",
}: {
  value: number | undefined;
  onChange: (decimal: string) => void;
  placeholder?: string;
  ariaLabel: string;
  className?: string;
}) {
  // 0.07 * 100 is 7.000000000000001 in binary floating point, and that would be the
  // field's visible content. Round hard enough to erase the artefact and finely
  // enough to keep a basis point (0.0001 -> 0.01%).
  const shown =
    value === undefined || Number.isNaN(value) ? "" : String(Math.round(value * 1e6) / 1e4);
  return (
    <span className="relative inline-block">
      <input
        className={`${inputClass} pr-6 ${className}`}
        type="number"
        step="any"
        placeholder={placeholder}
        aria-label={ariaLabel}
        value={shown}
        onChange={(e) => {
          const raw = e.target.value;
          onChange(raw === "" ? "" : String(Number(raw) / 100));
        }}
      />
      <span
        aria-hidden
        className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs text-ink-500"
      >
        %
      </span>
    </span>
  );
}
