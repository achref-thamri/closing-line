import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { loadConfig } from "@betting/config";
import { createRepositories, openDatabase } from "@betting/db";
import { markStarted, markStopped } from "./app/lifecycle.ts";
import { ensurePlayers } from "./app/players.ts";
import { compose } from "./compose.ts";
import { createLogger } from "./lib/logger.ts";
import { createPinger } from "./lib/ping.ts";
import { createTelegramNotifier } from "./lib/telegram.ts";
import { tick } from "./scheduler/runner.ts";

const config = loadConfig();
const logger = createLogger(config.logLevel);
const database = await openDatabase(config.database);
const notify = createTelegramNotifier({
    botToken: config.telegram.botToken,
    chatId: config.telegram.ownerChatId,
    logger,
});
const runner = compose({ config, db: database.db, logger, notify });
const ping = config.healthcheckPingUrl ? createPinger({ url: config.healthcheckPingUrl, logger }) : undefined;

const repos = createRepositories(database.db);
await ensurePlayers(repos, config);
mkdirSync(dirname(config.heartbeatPath), { recursive: true });
logger.info({ leagues: runner.leagues, database: config.database.kind }, "worker started");
await markStarted({ repos, now: () => new Date(), logger, notify });

let running: Promise<void> | undefined;
let timer: NodeJS.Timeout | undefined;

/** Ticks at the start of every minute; a tick still running when the next is due is not doubled up. */
function schedule(): void {
    timer = setTimeout(
        () => {
            const now = new Date();
            writeFileSync(config.heartbeatPath, now.toISOString());
            ping?.(now);
            running ??= tick(runner)
                .catch((error: unknown) => {
                    logger.error({ error: (error as Error).message }, "tick failed");
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
    await running;
    await markStopped({ repos });
    await database.close();
    process.exit(0);
}
process.once("SIGTERM", () => void shutdown("SIGTERM"));
process.once("SIGINT", () => void shutdown("SIGINT"));
