/**
 * Wraps an async task so overlapping calls share the run already in flight instead of starting another. Once it
 * settles, the next call starts a fresh run.
 */
export function singleFlight(task: () => Promise<void>): () => Promise<void> {
    let inFlight: Promise<void> | undefined;
    return () =>
        (inFlight ??= task().finally(() => {
            inFlight = undefined;
        }));
}
