import { playerStats, type MetricsBet, type PlayerStats } from "./metrics.ts";

/** How a bettor's bet from a slip ended: the selection's own result, or cashed out early. */
export type SlipStatus = "won" | "lost" | "void" | "cashed_out";

/** Profit of a bet that ran to the end. Money is in øre so totals add up exactly. */
export function heldProfitOre(
    bet: { stakeOre: number; lockedOdds: number },
    status: Exclude<SlipStatus, "cashed_out">,
): number {
    if (status === "won") return Math.round(bet.stakeOre * (bet.lockedOdds - 1));
    if (status === "lost") return -bet.stakeOre;
    return 0;
}

/**
 * The bookmaker's current price implied by a cash-out offer: a fair cash-out pays stake × locked / current.
 * The bookmaker keeps a margin on cash-outs, so this overstates the current price and understates the move;
 * undefined when the offer is not a usable price (nothing offered, or more than the bet could pay).
 */
export function impliedOddsFromCashout(bet: { stakeOre: number; lockedOdds: number }, offerOre: number) {
    if (offerOre <= 0) return undefined;
    const odds = (bet.stakeOre * bet.lockedOdds) / offerOre;
    return odds > 1 ? odds : undefined;
}

/**
 * How far the price moved after the bet, the player-prop version of CLV: positive when the bookmaker
 * cut the price, i.e. agreed with the bet. Same formula as `closingLineValue`.
 */
export function priceMove(lockedOdds: number, currentOdds: number): number {
    return lockedOdds / currentOdds - 1;
}

/** How much better the bet's odds were than the other books' price for the same selection. */
export function skew(lockedOdds: number, otherBooksOdds: number): number {
    return lockedOdds / otherBooksOdds - 1;
}

/**
 * Cashing out against holding to the end: the cash-out profit minus what holding would have made.
 * Positive when cashing out paid more.
 */
export function cashoutGainOre(
    bet: { stakeOre: number; lockedOdds: number; cashoutOfferOre: number },
    heldStatus: Exclude<SlipStatus, "cashed_out">,
): number {
    return bet.cashoutOfferOre - bet.stakeOre - heldProfitOre(bet, heldStatus);
}

/** The fields that make two bets one position: the same bettor backing the same player in the same market. */
export interface PositionBet {
    playerId: string;
    fixtureId: string | null;
    eventName: string | null;
    market: string;
    playerName: string | null;
    selection: string;
}

/**
 * Bets that express one read of a match: laddered lines on one player (over 0.5 and over 1.5), or the same
 * selection on two slips. Reports count positions so one good read is not counted as several independent wins.
 */
export function positionKey(bet: PositionBet): string {
    const event = bet.fixtureId ?? normalize(bet.eventName ?? "");
    const subject = bet.playerName ? normalize(bet.playerName) : normalize(bet.selection);
    return [bet.playerId, event, bet.market, subject].join("|");
}

/** Groups bets into positions, keeping the order in which each position first appears. */
export function groupPositions<T extends PositionBet>(bets: readonly T[]): T[][] {
    const groups = new Map<string, T[]>();
    for (const bet of bets) {
        const key = positionKey(bet);
        const group = groups.get(key);
        if (group) group.push(bet);
        else groups.set(key, [bet]);
    }
    return [...groups.values()];
}

/** Results per group, e.g. per tag, sport or live/pre-match; bets with no key are left out. */
export function statsBy<T extends MetricsBet>(
    bets: readonly T[],
    keyOf: (bet: T) => string | null | undefined,
): Map<string, PlayerStats> {
    const groups = new Map<string, T[]>();
    for (const bet of bets) {
        const key = keyOf(bet);
        if (key === null || key === undefined) continue;
        groups.set(key, [...(groups.get(key) ?? []), bet]);
    }
    return new Map([...groups].map(([key, group]) => [key, playerStats(group)]));
}

function normalize(text: string): string {
    return text.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/\s+/g, " ").trim();
}
