import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { loadConfig } from "@closing-line/config";
import { openDatabase } from "@closing-line/db";
import { markStarted, markStopped } from "./app/lifecycle.ts";
import { ensurePlayers } from "./app/players.ts";
import { compose } from "./compose.ts";
import { messageOf } from "./lib/errors.ts";
import { createLogger } from "./lib/logger.ts";
import { createPinger } from "./lib/ping.ts";
import { tick } from "./scheduler/runner.ts";

const config = loadConfig();
const logger = createLogger(config.logLevel);
const database = await openDatabase(config.database);
const worker = compose({ config, db: database.db, logger });
const ping = config.healthcheckPingUrl ? createPinger({ url: config.healthcheckPingUrl, logger }) : undefined;

await ensurePlayers(worker.repos, config);
mkdirSync(dirname(config.heartbeatPath), { recursive: true });
logger.info({ leagues: worker.runner.leagues, database: config.database.kind }, "worker started");
await markStarted({ repos: worker.repos, now: () => new Date(), logger, notify: worker.notify });

void worker.bot.start().catch((error: unknown) => {
    logger.error({ error: messageOf(error) }, "telegram bot stopped");
});
logger.info({}, "bet flow listening on Telegram");

let running: Promise<void> | undefined;
let timer: NodeJS.Timeout | undefined;

/** Ticks at the start of every minute; a tick still running when the next is due is not doubled up. */
function schedule(): void {
    timer = setTimeout(
        () => {
            const now = new Date();
            writeFileSync(config.heartbeatPath, now.toISOString());
            ping?.(now);
            running ??= tick(worker.runner)
                .catch((error: unknown) => {
                    logger.error({ error: messageOf(error) }, "tick failed");
                })
                .finally(() => {
                    running = undefined;
                });
            schedule();
        },
        60_000 - (Date.now() % 60_000),
    );
}
schedule();

async function shutdown(signal: string): Promise<void> {
    logger.info({ signal }, "shutting down");
    clearTimeout(timer);
    await worker.bot.stop();
    await running;
    await markStopped({ repos: worker.repos });
    await database.close();
    process.exit(0);
}
process.once("SIGTERM", () => void shutdown("SIGTERM"));
process.once("SIGINT", () => void shutdown("SIGINT"));
