"use client";

/** Shown when the page cannot load, e.g. the database is unreachable; the worker keeps running either way. */
export default function DashboardError({ reset }: { error: Error; reset: () => void }) {
    return (
        <main className="mx-auto max-w-[88rem] space-y-4 px-4 py-8">
            <h1 className="text-2xl font-semibold">Closing Line</h1>
            <p className="text-sm text-zinc-500">
                The dashboard could not read the database just now. Bets and polls carry on in the worker.
            </p>
            <button
                type="button"
                onClick={reset}
                className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-700"
            >
                Try again
            </button>
        </main>
    );
}
