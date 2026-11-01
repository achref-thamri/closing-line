import type { Config } from "@betting/config";
import {
    availableBankrollOre,
    closingLineValue,
    fairProbabilities,
    favourite,
    findValueBets,
    kellyStake,
    settledLossOre,
    type CreditPriority,
    type Outcome,
} from "@betting/core";
import type { NewOddsSnapshot, Repositories } from "@betting/db";
import type { EventOdds, OddsSource } from "../ports/odds.ts";
import type { CreditGuard } from "./creditGuard.ts";
import { FAVOURITE, SCANNER } from "./players.ts";

const WEEK_MS = 7 * 86_400_000;

export interface PollOddsDeps {
    source: Pick<OddsSource, "odds">;
    guard: Pick<CreditGuard, "spend">;
    repos: Pick<Repositories, "fixtures" | "odds" | "bets">;
    config: Pick<
        Config,
        | "bookmakers"
        | "sharpBookmaker"
        | "exchangeCommission"
        | "scanner"
        | "startingBankroll"
        | "benchmarkStake"
        | "closingWindowMinutes"
        | "weeklyLossPause"
        | "timezone"
    >;
    now: () => Date;
    notify: (message: string) => Promise<void>;
}

export type PollReport =
    | { skipped: true; reason: string }
    | { skipped: false; events: number; scannerBets: number; favouriteBets: number; closingUpdates: number };

/**
 * One paid odds poll for a league: stores every price, lets the scanner bet on value, and, close to kickoff,
 * records closing prices for open bets and places the favourite benchmark bet.
 */
export async function pollOdds(deps: PollOddsDeps, league: string, priority: CreditPriority): Promise<PollReport> {
    const { config } = deps;
    const result = await deps.guard.spend(1, priority, () => deps.source.odds(league, config.bookmakers));
    if (!result.ok) return { skipped: true, reason: result.reason };

    const now = deps.now();
    const report = {
        skipped: false as const,
        events: result.data.length,
        scannerBets: 0,
        favouriteBets: 0,
        closingUpdates: 0,
    };
    const scannerPaused = await isScannerPaused(deps, now);

    for (const event of result.data) {
        const minutesToKickoff = (event.kickoff.getTime() - now.getTime()) / 60_000;
        const closing = minutesToKickoff > 0 && minutesToKickoff <= config.closingWindowMinutes;
        await deps.repos.fixtures.upsert([event]);
        await deps.repos.odds.insert(snapshotsOf(event, now, closing ? "closing" : "poll"));
        if (minutesToKickoff <= 0) continue;

        const fair = fairProbabilities(
            event.quotes,
            config.sharpBookmaker,
            now,
            config.scanner.maxSharpAgeMinutes * 60_000,
        );
        if (!fair) continue;

        if (!scannerPaused) report.scannerBets += await scannerBets(deps, event, fair);
        if (closing) {
            report.favouriteBets += await favouriteBet(deps, event, fair);
            report.closingUpdates += await recordClosing(deps, event, fair);
        }
    }
    return report;
}

async function scannerBets(deps: PollOddsDeps, event: EventOdds, fair: Record<Outcome, number>): Promise<number> {
    const { config } = deps;
    const values = findValueBets(event.quotes, fair, {
        sharpBookmaker: config.sharpBookmaker,
        commission: config.exchangeCommission,
        minEdge: config.scanner.minEdge,
    });
    let placed = 0;
    for (const value of values) {
        const bankrollOre = availableBankrollOre(
            config.startingBankroll * 100,
            await deps.repos.bets.forPlayer(SCANNER),
        );
        const stake = kellyStake(bankrollOre / 100, value.netOdds, value.fairProbability, config.scanner.stake);
        if (stake === 0) continue;
        const bet = await deps.repos.bets.place({
            playerId: SCANNER,
            fixtureId: event.id,
            market: "h2h",
            selection: value.selection,
            stakeOre: stake * 100,
            lockedOdds: value.netOdds,
            bookmaker: value.bookmaker,
            sharpFairOddsAtBet: value.fairOdds,
            edgeAtBet: value.edge,
        });
        if (!bet) continue;
        placed++;
        await deps.notify(
            `🔎 Value bet: ${teamOf(event, value.selection)} @ ${value.offeredOdds.toFixed(2)} (${value.bookmaker})\n` +
                `${event.homeTeam} v ${event.awayTeam}, ${kickoffText(event.kickoff, config.timezone)}\n` +
                `Fair ${value.fairOdds.toFixed(2)}, edge ${(value.edge * 100).toFixed(1)}%, paper stake ${stake} kr`,
        );
    }
    return placed;
}

async function favouriteBet(deps: PollOddsDeps, event: EventOdds, fair: Record<Outcome, number>): Promise<number> {
    const pick = favourite(event.quotes, deps.config.sharpBookmaker);
    if (!pick) return 0;
    const existing = await deps.repos.bets.forPlayer(FAVOURITE);
    if (existing.some((bet) => bet.fixtureId === event.id)) return 0;
    const bet = await deps.repos.bets.place({
        playerId: FAVOURITE,
        fixtureId: event.id,
        market: "h2h",
        selection: pick.selection,
        stakeOre: Math.round(deps.config.benchmarkStake * 100),
        lockedOdds: pick.price,
        bookmaker: pick.bookmaker,
        sharpFairOddsAtBet: 1 / fair[pick.selection],
        edgeAtBet: pick.price * fair[pick.selection] - 1,
    });
    return bet ? 1 : 0;
}

/** Closing value from Pinnacle's price in the last poll before kickoff (ADR 0006); a later poll overwrites it. */
async function recordClosing(deps: PollOddsDeps, event: EventOdds, fair: Record<Outcome, number>): Promise<number> {
    const open = await deps.repos.bets.open([event.id]);
    for (const bet of open) {
        const fairOdds = 1 / fair[bet.selection as Outcome];
        await deps.repos.bets.setClosing(bet.id, {
            fairOdds,
            clv: closingLineValue(bet.lockedOdds, fairOdds),
            provisional: false,
        });
    }
    return open.length;
}

/** The scanner sits out after losing `weeklyLossPause` of its starting bankroll in the last seven days. */
async function isScannerPaused(deps: PollOddsDeps, now: Date): Promise<boolean> {
    const bets = await deps.repos.bets.forPlayer(SCANNER);
    const lossOre = settledLossOre(bets, new Date(now.getTime() - WEEK_MS));
    return lossOre >= deps.config.weeklyLossPause * deps.config.startingBankroll * 100;
}

function snapshotsOf(event: EventOdds, takenAt: Date, kind: "poll" | "closing"): NewOddsSnapshot[] {
    return event.quotes.map((quote) => ({
        fixtureId: event.id,
        bookmaker: quote.bookmaker,
        market: quote.market,
        selection: quote.selection,
        price: quote.price,
        bookmakerUpdatedAt: quote.updatedAt,
        takenAt,
        kind,
    }));
}

function teamOf(event: EventOdds, selection: Outcome): string {
    if (selection === "home") return event.homeTeam;
    if (selection === "away") return event.awayTeam;
    return "Draw";
}

function kickoffText(kickoff: Date, timeZone: string): string {
    return kickoff.toLocaleString("en-GB", { timeZone, weekday: "short", hour: "2-digit", minute: "2-digit" });
}
