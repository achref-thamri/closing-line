import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type { Fetch } from "./http.ts";
import type { Logger } from "./logger.ts";

const HOUR_MS = 3_600_000;
/** Backups run nightly; a day plus two hours of slack before the newest one counts as missed. */
const MAX_AGE_MS = 26 * HOUR_MS;
const TIMEOUT_MS = 10_000;

/**
 * Once an hour, tells a healthchecks.io check whether the nightly backup is fresh: a ping while the newest dump in
 * `dir` is under 26 hours old, the check's `/fail` URL when it is older or there is none, which alerts at once.
 */
export function createBackupCheck(options: {
    url: string;
    dir: string;
    logger: Logger;
    fetch?: Fetch;
    everyMs?: number;
}): (now: Date) => void {
    const doFetch = options.fetch ?? fetch;
    const everyMs = options.everyMs ?? HOUR_MS;
    let last = -Infinity;
    return (now) => {
        if (now.getTime() - last < everyMs) return;
        last = now.getTime();
        const age = newestDumpAgeMs(options.dir, now);
        const fresh = age !== undefined && age <= MAX_AGE_MS;
        doFetch(fresh ? options.url : `${options.url}/fail`, { signal: AbortSignal.timeout(TIMEOUT_MS) })
            .then((response) => {
                if (!response.ok) options.logger.warn({ status: response.status }, "backup ping refused");
            })
            .catch((error: unknown) => {
                options.logger.warn(
                    { error: error instanceof Error ? error.name : typeof error },
                    "backup ping failed",
                );
            });
        if (!fresh)
            options.logger.warn({ ageHours: age === undefined ? null : Math.round(age / HOUR_MS) }, "backup is stale");
    };
}

function newestDumpAgeMs(dir: string, now: Date): number | undefined {
    let names: string[];
    try {
        names = readdirSync(dir);
    } catch {
        return undefined;
    }
    const times = names
        .filter((name) => /^closing-line-.*\.sql\.gz$/.test(name))
        .map((name) => statSync(join(dir, name)).mtimeMs);
    return times.length === 0 ? undefined : now.getTime() - Math.max(...times);
}
