"use client";

import { useI18n } from "@/lib/i18n/client";

export default function GlobalError({ error, reset }: { error: Error; reset: () => void }) {
  const { t } = useI18n();
  return (
    <div className="rounded-lg border border-bad-700/30 bg-surface p-6">
      <h1 className="text-base font-semibold text-bad-700">{t.error.heading}</h1>
      <p className="mt-2 text-sm text-ink-700">{error.message}</p>
      <p className="mt-3 text-sm text-ink-500">{t.error.body}</p>
      <button
        onClick={reset}
        className="mt-4 rounded-md border border-ink-300 px-3 py-1.5 text-sm hover:bg-ink-100"
      >
        {t.error.retry}
      </button>
    </div>
  );
}
