import type { Config } from "@closing-line/config";
import { createRepositories, type Database, type Repositories } from "@closing-line/db";
import { FootballDataClient } from "./adapters/footballData/client.ts";
import { OddsApiClient } from "./adapters/oddsApi/client.ts";
import { createTelegramBot, type TelegramBot } from "./adapters/telegram/bot.ts";
import { BetFlow } from "./app/betFlow.ts";
import { Bettors } from "./app/bettors.ts";
import { CreditGuard } from "./app/creditGuard.ts";
import { bestPicks } from "./app/picks.ts";
import { pollOdds, type PollReport } from "./app/pollOdds.ts";
import { remindOpenBets } from "./app/reminders.ts";
import { SettleFlow } from "./app/settleFlow.ts";
import { settleBets } from "./app/settleBets.ts";
import { syncFixtures } from "./app/syncFixtures.ts";
import { createPriceGoneSender, createTipSender, tipRecipients } from "./app/tips.ts";
import { weeklyReport } from "./app/weeklyReport.ts";
import type { Reply } from "./app/chat.ts";
import type { Logger } from "./lib/logger.ts";
import { singleFlight } from "./lib/singleFlight.ts";
import { createTextSender, type Notify } from "./lib/telegram.ts";
import type { JobHandlers, JobOutcome, RunnerDeps } from "./scheduler/runner.ts";

const PICKS_REFRESH_MS = 12 * 3_600_000;

/** Everything the worker runs, wired once; `main.ts` only starts and stops it. */
export interface Worker {
    repos: Repositories;
    /** Messages to the owner. */
    notify: Notify;
    /** The scheduler's jobs, for `tick`. */
    runner: RunnerDeps;
    /** The bet flow, settle flow and /picks, attached and ready to start. */
    bot: TelegramBot;
}

/** The composition root: builds the adapters once and wires them into the jobs and the Telegram flows. */
export function compose(options: { config: Config; db: Database; logger: Logger; now?: () => Date }): Worker {
    const { config, logger } = options;
    const now = options.now ?? (() => new Date());
    const repos = createRepositories(options.db);
    const bot = createTelegramBot({ botToken: config.telegram.botToken, logger });
    const sendText = createTextSender({ api: bot.api, logger });
    const ownerChatId = config.telegram.ownerChatId;
    const notify: Notify = (text) => sendText(ownerChatId, text);

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
    // Value-bet tips go to the owner and every approved bettor; other alerts stay with the owner.
    const tipOptions = {
        timeZone: config.timezone,
        logger,
        send: (chatId: number, reply: Reply) => bot.messenger.send(chatId, reply),
        recipients: async () => tipRecipients(await repos.players.list(), ownerChatId),
    };
    const tip = createTipSender(tipOptions);
    const priceGone = createPriceGoneSender(tipOptions);
    const pollDeps = { source: odds, guard, repos, config, now, notify, tip, priceGone };

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
            message: `${await remindOpenBets({ repos, send: sendText, now })} reminded`,
        }),
        weekly_report: async () => {
            // Everyone learns from the report, so every bettor gets it, tips paused or not.
            const report = await weeklyReport({ repos, config, now });
            const chats = tipRecipients(await repos.players.list(), ownerChatId);
            await Promise.all(chats.map(({ chatId }) => sendText(chatId, report)));
            return { status: "succeeded" };
        },
    };

    // /picks: refresh a league's odds when the stored ones are over 12 hours old, within the credit guard. Bettors
    // asking at the same time share one refresh, so the credits are spent once. These polls run outside the
    // scheduler, so job_runs has no row for them; the log line is their record.
    const refresh = singleFlight(async () => {
        for (const league of config.leagues) {
            const last = await repos.odds.lastTakenAt(league.oddsApiKey);
            if (last && now().getTime() - last.getTime() < PICKS_REFRESH_MS) continue;
            const report = await pollOdds(pollDeps, league.oddsApiKey, "scan");
            logger.info({ league: league.oddsApiKey, ...pollOutcome(report) }, "picks refresh polled");
        }
    });
    const picks = () => bestPicks({ repos, config, now, refresh });

    // Bettors log, settle and look up bets in Telegram.
    const bettors = new Bettors({ repos, config, messenger: bot.messenger, now });
    bot.attach({
        bettors,
        bets: new BetFlow({ repos, bettors, config, messenger: bot.messenger, logger, now }),
        settle: new SettleFlow({ repos, messenger: bot.messenger, ownerChatId, logger, now }),
        picks,
    });

    return {
        repos,
        notify,
        bot,
        runner: {
            repos,
            leagues: config.leagues.map((league) => league.oddsApiKey),
            timeZone: config.timezone,
            handlers,
            now,
            logger,
            notify,
        },
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
