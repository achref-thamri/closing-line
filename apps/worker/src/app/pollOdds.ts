import type { Config } from "@closing-line/config";
import {
    availableFromTotals,
    bestOffer,
    closingLineValue,
    fairProbabilities,
    favourite,
    findValueBets,
    minimumOdds,
    scannerStake,
    toOutcome,
    type CreditPriority,
    type Outcome,
} from "@closing-line/core";
import type { Bet, NewDecision, NewOddsSnapshot, Repositories } from "@closing-line/db";
import type { EventOdds, OddsSource } from "../ports/odds.ts";
import type { CreditGuard } from "./creditGuard.ts";
import { FAVOURITE, SCANNER } from "./players.ts";
import { formatPriceGone, formatTip, type PriceGone, type Tip } from "./tips.ts";

const WEEK_MS = 7 * 86_400_000;

export interface PollOddsDeps {
    source: Pick<OddsSource, "odds">;
    guard: Pick<CreditGuard, "spend">;
    repos: Pick<Repositories, "fixtures" | "odds" | "bets" | "decisions">;
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
    /** Value-bet tips, the same for every bettor. Without it the owner gets them through `notify`. */
    tip?: (tip: Tip) => Promise<void>;
    /** Tells bettors a tip's price has gone. Without it the owner hears through `notify`. */
    priceGone?: (gone: PriceGone) => Promise<void>;
}

export type PollReport =
    | { skipped: true; reason: string }
    | { skipped: false; events: number; scannerBets: number; favouriteBets: number; closingUpdates: number };

/**
 * One paid odds poll for a league: stores every price, lets the scanner bet on value, records what it decided for
 * each match (bet, or pass and why), says when an earlier tip's price has gone, and, close to kickoff, records
 * closing prices for open bets and places the favourite benchmark bet.
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
    const minutesToKickoff = (event: EventOdds) => (event.kickoff.getTime() - now.getTime()) / 60_000;
    const isClosing = (event: EventOdds) =>
        minutesToKickoff(event) > 0 && minutesToKickoff(event) <= config.closingWindowMinutes;
    await deps.repos.fixtures.upsert(result.data);
    await deps.repos.odds.insert(
        result.data.flatMap((event) => snapshotsOf(event, now, isClosing(event) ? "closing" : "poll")),
    );
    // Read once per poll; each bet placed below takes its stake off, as the next query would have.
    const scanner = (await isScannerPaused(deps, now)) ? undefined : { availableOre: await scannerAvailableOre(deps) };

    const decisions: NewDecision[] = [];
    // Tips from earlier polls; read before this poll bets, so a new tip is not checked against its own prices.
    const tipped = (await deps.repos.bets.open(result.data.map((event) => event.id))).filter(
        (bet) => bet.playerId === SCANNER && bet.market === "h2h" && bet.priceGoneAt === null,
    );

    for (const event of result.data) {
        const minutes = Math.round(minutesToKickoff(event));
        if (minutes <= 0) continue;
        const closing = isClosing(event);
        const decided = { fixtureId: event.id, takenAt: now, minutesToKickoff: minutes };

        const fair = fairProbabilities(
            event.quotes,
            config.sharpBookmaker,
            now,
            config.scanner.maxSharpAgeMinutes * 60_000,
        );
        if (!fair) {
            decisions.push({ ...decided, outcome: "pass", reason: "no_fresh_sharp" });
            continue;
        }
        for (const bet of tipped.filter((tip) => tip.fixtureId === event.id)) {
            await checkPriceGone(deps, event, fair, bet, now);
        }

        const best = bestOffer(event.quotes, fair, {
            sharpBookmaker: config.sharpBookmaker,
            commission: config.exchangeCommission,
        });
        let reason: Reason;
        if (minutes > config.scanner.maxHoursToKickoff * 60) {
            // Still recorded with the best price, so the report can show what the scanner left alone.
            reason = "too_early";
        } else if (scanner) {
            const bets = await scannerBets(deps, event, fair, scanner);
            report.scannerBets += bets.placed;
            reason = bets.reason;
        } else {
            reason = best && best.edge >= config.scanner.minEdge ? "paused" : "no_edge";
        }
        decisions.push({
            ...decided,
            outcome: reason === "value" ? "bet" : "pass",
            reason,
            bestSelection: best?.selection ?? null,
            bestBookmaker: best?.bookmaker ?? null,
            bestOdds: best?.netOdds ?? null,
            bestEdge: best?.edge ?? null,
            fairHome: fair.home,
            fairDraw: fair.draw,
            fairAway: fair.away,
        });

        if (closing) {
            report.favouriteBets += await favouriteBet(deps, event, fair);
            report.closingUpdates += await recordClosing(deps, event, fair);
        }
    }
    await deps.repos.decisions.insert(decisions);
    return report;
}

type Reason = NewDecision["reason"];

async function scannerBets(
    deps: PollOddsDeps,
    event: EventOdds,
    fair: Record<Outcome, number>,
    bankroll: { availableOre: number },
): Promise<{ placed: number; reason: Reason }> {
    const { config } = deps;
    const values = findValueBets(event.quotes, fair, {
        sharpBookmaker: config.sharpBookmaker,
        commission: config.exchangeCommission,
        minEdge: config.scanner.minEdge,
        maxFairOdds: config.scanner.maxFairOdds,
    });
    let placed = 0;
    let sized = 0;
    for (const value of values) {
        const stake = scannerStake(
            bankroll.availableOre / 100,
            value.netOdds,
            value.fairProbability,
            config.scanner.stake,
        );
        if (stake === 0) continue;
        sized++;
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
        bankroll.availableOre -= bet.stakeOre;
        const tip: Tip = {
            fixtureId: event.id,
            selection: value.selection,
            homeTeam: event.homeTeam,
            awayTeam: event.awayTeam,
            kickoff: event.kickoff,
            pick: teamOf(event, value.selection),
            fairOdds: value.fairOdds,
            minOdds: minimumOdds(value.fairOdds, config.scanner.minEdge),
            offers: value.offers,
            paperStakeKr: stake,
            seenAt: deps.now(),
        };
        if (deps.tip) await deps.tip(tip);
        else await deps.notify(formatTip(tip, config.timezone) ?? "");
    }
    if (placed > 0) return { placed, reason: "value" };
    if (values.length === 0) return { placed, reason: "no_edge" };
    // Value, but the bankroll is too low for even the minimum stake, or the scanner already backed these selections.
    return { placed, reason: sized === 0 ? "stake_too_small" : "already_bet" };
}

/** A tip's price has gone when no bookmaker pays the fair price for its selection any more. */
async function checkPriceGone(
    deps: PollOddsDeps,
    event: EventOdds,
    fair: Record<Outcome, number>,
    bet: Bet,
    now: Date,
): Promise<void> {
    const { config } = deps;
    const selection = toOutcome(bet.selection);
    const best = findValueBets(event.quotes, fair, {
        sharpBookmaker: config.sharpBookmaker,
        commission: config.exchangeCommission,
        minEdge: -Infinity,
    }).find((value) => value.selection === selection);
    if (best && best.edge >= 0) return;
    // A /picks refresh can poll the same league as a scheduled poll; only the one that marks the tip alerts.
    if (!(await deps.repos.bets.markPriceGone(bet.id, now))) return;
    const gone: PriceGone = {
        homeTeam: event.homeTeam,
        awayTeam: event.awayTeam,
        kickoff: event.kickoff,
        pick: teamOf(event, selection),
        tippedOdds: bet.lockedOdds,
        tippedAt: bet.createdAt,
        fairOdds: 1 / fair[selection],
        ...(best ? { best: { bookmaker: best.bookmaker, offeredOdds: best.offeredOdds } } : {}),
    };
    if (deps.priceGone) await deps.priceGone(gone);
    else await deps.notify(formatPriceGone(gone, config.timezone));
}

async function favouriteBet(deps: PollOddsDeps, event: EventOdds, fair: Record<Outcome, number>): Promise<number> {
    const pick = favourite(event.quotes, deps.config.sharpBookmaker);
    if (!pick) return 0;
    if (await deps.repos.bets.hasBet(FAVOURITE, event.id)) return 0;
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
    // Only match-result bets have a Pinnacle price to close against; props on the fixture do not.
    const open = (await deps.repos.bets.open([event.id])).filter((bet) => bet.market === "h2h");
    for (const bet of open) {
        const fairOdds = 1 / fair[toOutcome(bet.selection)];
        await deps.repos.bets.setClosing(bet.id, {
            fairOdds,
            clv: closingLineValue(bet.lockedOdds, fairOdds),
            provisional: false,
        });
    }
    return open.length;
}

/** What the scanner can stake: its starting bankroll plus settled profit, minus stakes still open. */
async function scannerAvailableOre(deps: PollOddsDeps): Promise<number> {
    const totals = (await deps.repos.bets.totals()).get(SCANNER) ?? { profitOre: 0, openStakeOre: 0 };
    return availableFromTotals(deps.config.startingBankroll * 100, totals);
}

/** The scanner sits out after losing `weeklyLossPause` of its starting bankroll in the last seven days. */
async function isScannerPaused(deps: PollOddsDeps, now: Date): Promise<boolean> {
    const week = (await deps.repos.bets.totals({ settledSince: new Date(now.getTime() - WEEK_MS) })).get(SCANNER);
    const lossOre = Math.max(0, -(week?.profitOre ?? 0));
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
