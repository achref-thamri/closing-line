import type { Repositories } from "@closing-line/db";
import * as zod from "zod";
import type { Logger } from "../lib/logger.ts";
import type { Notify } from "../lib/telegram.ts";

const KEY = "lifecycle";
/** A crash loop restarts the container every minute or so; one alert per hour is enough. */
const CRASH_ALERT_EVERY_MS = 60 * 60_000;

const storedLifecycle = zod.object({ running: zod.boolean(), crashAlertedAt: zod.string().optional() });
type Lifecycle = zod.infer<typeof storedLifecycle>;

/** The stored lifecycle, or `fallback` when there is none or it doesn't read as one. */
async function lifecycleOf(repos: Pick<Repositories, "state">, fallback: Lifecycle): Promise<Lifecycle> {
    const stored = storedLifecycle.safeParse(await repos.state.get(KEY));
    return stored.success ? stored.data : fallback;
}

export interface LifecycleDeps {
    repos: Pick<Repositories, "state">;
    now: () => Date;
    logger: Logger;
    notify: Notify;
}

/**
 * Called at startup. Planned restarts (deploys, reboots) stop the worker with SIGTERM, which clears the running
 * flag, so they stay silent. A flag still set means the previous run died without a clean shutdown: the owner is
 * told, at most once an hour.
 */
export async function markStarted(deps: LifecycleDeps): Promise<void> {
    const previous = await lifecycleOf(deps.repos, { running: false });
    const now = deps.now();
    await deps.repos.state.set(KEY, { ...previous, running: true });
    if (!previous.running) {
        deps.logger.info({}, "started after a clean shutdown");
        return;
    }
    deps.logger.warn({}, "previous run ended without a clean shutdown");
    const lastAlert = previous.crashAlertedAt ? new Date(previous.crashAlertedAt).getTime() : -Infinity;
    if (now.getTime() - lastAlert < CRASH_ALERT_EVERY_MS) return;
    await deps.repos.state.set(KEY, { running: true, crashAlertedAt: now.toISOString() });
    await deps.notify(
        "⚠️ Closing Line restarted unexpectedly. The previous run ended without a clean shutdown; check the server logs.",
    );
}

/** Called on SIGTERM/SIGINT after the running tick finished, so the next start is recognised as planned. */
export async function markStopped(deps: Pick<LifecycleDeps, "repos">): Promise<void> {
    const previous = await lifecycleOf(deps.repos, { running: true });
    await deps.repos.state.set(KEY, { ...previous, running: false });
}
