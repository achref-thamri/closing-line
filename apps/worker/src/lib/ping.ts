import type { Fetch } from "./http.ts";
import type { Logger } from "./logger.ts";

const PING_EVERY_MS = 5 * 60_000;
const TIMEOUT_MS = 10_000;

/**
 * Pings an external dead man's switch at most every few minutes, so an outage of the whole server (which can no
 * longer send Telegram alerts itself) is still reported. Failures are logged and never thrown: the monitor alerts
 * when pings stop arriving. The URL is a secret, so it is never logged.
 */
export function createPinger(options: {
    url: string;
    logger: Logger;
    fetch?: Fetch;
    everyMs?: number;
}): (now: Date) => void {
    const doFetch = options.fetch ?? fetch;
    const everyMs = options.everyMs ?? PING_EVERY_MS;
    let last = -Infinity;
    let inFlight = false;
    return (now) => {
        if (inFlight || now.getTime() - last < everyMs) return;
        last = now.getTime();
        inFlight = true;
        doFetch(options.url, { signal: AbortSignal.timeout(TIMEOUT_MS) })
            .then((response) => {
                if (!response.ok) options.logger.warn({ status: response.status }, "healthcheck ping refused");
            })
            .catch((error: unknown) => {
                options.logger.warn({ error: (error as Error).name }, "healthcheck ping failed");
            })
            .finally(() => {
                inFlight = false;
            });
    };
}
