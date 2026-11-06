import { setTimeout as sleep } from "node:timers/promises";
import { messageOf } from "./errors.ts";
import type { Logger } from "./logger.ts";

const RETRY_MS = 5 * 60_000;

export interface Polling {
    /** False from the moment polling fails until the next attempt starts. */
    isUp(): boolean;
    /** Ends the retries; call before stopping the bot, so its clean return is not retried. */
    stop(): void;
    /** Settles once polling has stopped for good. */
    done: Promise<void>;
}

/**
 * Runs Telegram long polling and starts it again when it fails (revoked token, a second poller, a network outage
 * grammY gives up on). While it is down `isUp` is false, which the worker uses to hold back the dead man's switch
 * ping: the scheduler's heartbeat would otherwise report a healthy worker that nobody can log bets with. The owner
 * also gets one message per outage, which arrives only when the failure is not the token itself.
 */
export function keepPolling(options: {
    start: () => Promise<void>;
    logger: Logger;
    notify: (text: string) => Promise<void>;
    retryMs?: number;
}): Polling {
    const retryMs = options.retryMs ?? RETRY_MS;
    const stopping = new AbortController();
    let up = true;

    async function run(): Promise<void> {
        let alerted = false;
        while (!stopping.signal.aborted) {
            up = true;
            try {
                // Resolves only when the bot is stopped on purpose.
                await options.start();
                return;
            } catch (error) {
                up = false;
                const message = messageOf(error);
                options.logger.error({ error: message, retryInMs: retryMs }, "telegram polling stopped");
                if (!alerted) {
                    alerted = true;
                    await options
                        .notify(`⚠️ Telegram polling stopped: ${message}. Retrying every ${retryMs / 60_000} minutes.`)
                        .catch(() => undefined);
                }
            }
            await sleep(retryMs, undefined, { signal: stopping.signal }).catch(() => undefined);
        }
    }

    return {
        isUp: () => up,
        stop: () => {
            stopping.abort();
        },
        done: run(),
    };
}
