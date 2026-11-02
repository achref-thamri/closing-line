import type { Config } from "@closing-line/config";
import { createRepositories, type Database } from "@closing-line/db";
import { FootballDataClient } from "./adapters/footballData/client.ts";
import { OddsApiClient } from "./adapters/oddsApi/client.ts";
import { CreditGuard } from "./app/creditGuard.ts";
import { pollOdds, type PollReport } from "./app/pollOdds.ts";
import { remindOpenBets } from "./app/reminders.ts";
import { settleBets } from "./app/settleBets.ts";
import { syncFixtures } from "./app/syncFixtures.ts";
import { weeklyReport } from "./app/weeklyReport.ts";
import type { Logger } from "./lib/logger.ts";
import { createTipSender, tipRecipients } from "./app/tips.ts";
import { createTelegramNotifier, type Notify } from "./lib/telegram.ts";
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
    const sendTo = (chatId: number, text: string) =>
        createTelegramNotifier({ botToken: config.telegram.botToken, chatId, logger })(text);
    // Value-bet tips go to the owner and every approved bettor; other alerts stay with the owner.
    const tip = createTipSender({
        timeZone: config.timezone,
        logger,
        send: (chatId, text) => sendTo(chatId, text),
        recipients: async () => tipRecipients(await repos.players.list(), config.telegram.ownerChatId),
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
        remind: async () => ({
            status: "succeeded",
            message: `${await remindOpenBets({ repos, send: sendTo, now })} reminded`,
        }),
        weekly_report: async () => {
            // Everyone learns from the report, so every bettor gets it, tips paused or not.
            const report = await weeklyReport({ repos, config, now });
            const chats = tipRecipients(await repos.players.list(), config.telegram.ownerChatId);
            await Promise.all(chats.map(({ chatId }) => sendTo(chatId, report)));
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
