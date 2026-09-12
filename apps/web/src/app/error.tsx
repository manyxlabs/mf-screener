"use client";

export default function GlobalError({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <div className="rounded-lg border border-bad-700/30 bg-surface p-6">
      <h1 className="text-base font-semibold text-bad-700">Could not load this page</h1>
      <p className="mt-2 text-sm text-ink-700">{error.message}</p>
      <p className="mt-3 text-sm text-ink-500">
        The API usually needs to be running on{" "}
        <code className="rounded bg-ink-100 px-1">
          {process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:8000"}
        </code>{" "}
        with data loaded. Start it with <code className="rounded bg-ink-100 px-1">make api</code>,
        and load the sample dataset with{" "}
        <code className="rounded bg-ink-100 px-1">make data-sample</code>.
      </p>
      <button
        onClick={reset}
        className="mt-4 rounded-md border border-ink-300 px-3 py-1.5 text-sm hover:bg-ink-100"
      >
        Try again
      </button>
    </div>
  );
}
