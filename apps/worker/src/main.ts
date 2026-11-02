import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { loadConfig } from "@closing-line/config";
import { createRepositories, openDatabase } from "@closing-line/db";
import { ClaudeSlipReader } from "./adapters/anthropic/slipReader.ts";
import { createBetBot, screenshotStore } from "./adapters/telegram/bot.ts";
import { BetFlow } from "./app/betFlow.ts";
import { markStarted, markStopped } from "./app/lifecycle.ts";
import { SettleFlow } from "./app/settleFlow.ts";
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

// The bet flow needs Claude to read slips; without a key the worker runs the scanner only.
const betBot = config.anthropic.apiKey ? createBetBot({ botToken: config.telegram.botToken, logger }) : undefined;
if (betBot && config.anthropic.apiKey) {
    const settle = new SettleFlow({
        repos,
        messenger: betBot.messenger,
        ownerChatId: config.telegram.ownerChatId,
        logger,
    });
    betBot.attach(
        new BetFlow({
            reader: new ClaudeSlipReader({ client: new Anthropic({ apiKey: config.anthropic.apiKey }) }),
            repos,
            config,
            messenger: betBot.messenger,
            // Screenshots are evidence for the bets: kept on the data volume next to the heartbeat.
            saveScreenshot: screenshotStore(join(dirname(config.heartbeatPath), "slips")),
            logger,
            settler: settle,
        }),
        settle,
    );
    void betBot.start().catch((error: unknown) => {
        logger.error({ error: (error as Error).message }, "telegram bot stopped");
    });
    logger.info({ slips: true }, "bet flow listening on Telegram");
}

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
    await betBot?.stop();
    await running;
    await markStopped({ repos });
    await database.close();
    process.exit(0);
}
process.once("SIGTERM", () => void shutdown("SIGTERM"));
process.once("SIGINT", () => void shutdown("SIGINT"));
