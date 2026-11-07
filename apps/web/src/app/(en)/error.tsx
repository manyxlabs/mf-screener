"use client";

import { useI18n } from "@/lib/i18n/client";

export default function GlobalError({ error, reset }: { error: Error; reset: () => void }) {
  const { t } = useI18n();
  return (
    <div className="panel rounded-3xl p-6">
      <h1 className="text-base font-semibold text-bad-700">{t.error.heading}</h1>
      <p className="mt-2 text-sm text-ink-700">{error.message}</p>
      <p className="mt-3 text-sm text-ink-500">{t.error.body}</p>
      <button onClick={reset} className="btn-glass mt-4">
        {t.error.retry}
      </button>
    </div>
  );
}
