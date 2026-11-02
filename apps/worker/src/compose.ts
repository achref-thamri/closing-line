import type { Config } from "@closing-line/config";
import { createRepositories, type Database } from "@closing-line/db";
import { FootballDataClient } from "./adapters/footballData/client.ts";
import { OddsApiClient } from "./adapters/oddsApi/client.ts";
import { CreditGuard } from "./app/creditGuard.ts";
import { pollOdds, type PollReport } from "./app/pollOdds.ts";
import { settleBets } from "./app/settleBets.ts";
import { syncFixtures } from "./app/syncFixtures.ts";
import { weeklyReport } from "./app/weeklyReport.ts";
import type { Logger } from "./lib/logger.ts";
import { createTelegramBroadcast, type Notify } from "./lib/telegram.ts";
import type { JobHandlers, JobOutcome, RunnerDeps } from "./scheduler/runner.ts";

/** Wires adapters and use cases into the scheduler's job handlers. */
export function compose(options: {
    config: Config;
    db: Database;
    logger: Logger;
    notify: Notify;
    now?: () => Date;
}): RunnerDeps {
    const { config, logger, notify } = options;
    const now = options.now ?? (() => new Date());
    const repos = createRepositories(options.db);
    const odds = new OddsApiClient({ apiKey: config.oddsApi.apiKey, now });
    const results = new FootballDataClient({ token: config.footballData.token });
    const guard = new CreditGuard({
        usage: repos.apiUsage,
        source: odds,
        now,
        reserve: config.credits.reserve,
        warnAt: config.credits.warnAt,
        warn: notify,
    });
    // Value-bet tips go to the owner and every approved human; other alerts stay with the owner.
    const tip = createTelegramBroadcast({
        botToken: config.telegram.botToken,
        logger,
        chats: async () => [
            config.telegram.ownerChatId,
            ...(await repos.players.list()).flatMap((player) =>
                player.kind === "human" && player.telegramChatId ? [Number(player.telegramChatId)] : [],
            ),
        ],
    });
    const pollDeps = { source: odds, guard, repos, config, now, notify, tip };

    const handlers: JobHandlers = {
        sync: async () => ({
            status: "succeeded",
            message: `${await syncFixtures({ source: odds, guard, repos, config })} fixtures`,
        }),
        morning_poll: async (job) => pollOutcome(await pollOdds(pollDeps, leagueOf(job.league), "scan")),
        prekickoff_poll: async (job) => pollOutcome(await pollOdds(pollDeps, leagueOf(job.league), "closing")),
        settle: async () => {
            const report = await settleBets({ results, repos, config, now, notify });
            if (report.unmatched.length > 0)
                logger.warn({ unmatched: report.unmatched }, "fixtures without a result yet");
            return { status: "succeeded", message: `${report.fixtures} fixtures, ${report.settledBets} bets settled` };
        },
        weekly_report: async () => {
            await notify(await weeklyReport({ repos, config, now }));
            return { status: "succeeded" };
        },
    };

    return {
        repos,
        leagues: config.leagues.map((league) => league.oddsApiKey),
        timeZone: config.timezone,
        handlers,
        now,
        logger,
        notify,
    };
}

function pollOutcome(report: PollReport): JobOutcome {
    if (report.skipped) return { status: "skipped", message: report.reason };
    return {
        status: "succeeded",
        message: `${report.events} events, ${report.scannerBets} value bets, ${report.favouriteBets} favourite bets, ${report.closingUpdates} closing prices`,
    };
}

function leagueOf(league: string | undefined): string {
    if (!league) throw new Error("poll job without a league");
    return league;
}
