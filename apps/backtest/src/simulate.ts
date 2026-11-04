import {
    closingLineValue,
    devigPower,
    findValueBets,
    kellyStake,
    OUTCOMES,
    outcomeOf,
    type PriceQuote,
    type StakeRules,
} from "@closing-line/core";
import { SOFT_BOOKS, type PastMatch, type Prices } from "./seasons.ts";

export interface BacktestOptions {
    minEdge: number;
    startingBankroll: number;
    stake: StakeRules;
}

export interface BacktestResult {
    minEdge: number;
    matches: number;
    bets: number;
    won: number;
    staked: number;
    profit: number;
    /** Profit per kroner staked. */
    roi: number | undefined;
    /** Average closing line value against Pinnacle's de-vigged closing price. */
    averageClv: number | undefined;
    /** Share of bets whose price beat the fair closing price. */
    beatClosing: number | undefined;
    /** Largest fall from a bankroll peak, as a share of that peak. */
    maxDrawdown: number;
    finalBankroll: number;
}

/**
 * Replays the scanner on past matches in order: Pinnacle's early prices de-vigged give the fair price, the best soft
 * book above `minEdge` is backed with the scanner's quarter-Kelly stake on a running bankroll, CLV is measured
 * against Pinnacle's de-vigged closing price, and the bet settles on the final score.
 */
export function backtest(matches: readonly PastMatch[], options: BacktestOptions): BacktestResult {
    let bankroll = options.startingBankroll;
    let peak = bankroll;
    let maxDrawdown = 0;
    let bets = 0;
    let won = 0;
    let staked = 0;
    let profit = 0;
    const clvs: number[] = [];

    for (const match of matches) {
        const fair = toRecord(devigPower(OUTCOMES.map((outcome) => match.sharpEarly[outcome])));
        const closing = toRecord(devigPower(OUTCOMES.map((outcome) => match.sharpClosing[outcome])));
        const values = findValueBets(quotesOf(match), fair, {
            sharpBookmaker: "pinnacle",
            commission: {},
            minEdge: options.minEdge,
        });
        for (const value of values) {
            const stake = kellyStake(bankroll, value.netOdds, value.fairProbability, options.stake);
            if (stake === 0) continue;
            const wins = outcomeOf(match.homeGoals, match.awayGoals) === value.selection;
            const result = wins ? stake * (value.netOdds - 1) : -stake;
            bets++;
            if (wins) won++;
            staked += stake;
            profit += result;
            bankroll += result;
            clvs.push(closingLineValue(value.netOdds, 1 / closing[value.selection]));
            peak = Math.max(peak, bankroll);
            maxDrawdown = Math.max(maxDrawdown, (peak - bankroll) / peak);
        }
    }

    return {
        minEdge: options.minEdge,
        matches: matches.length,
        bets,
        won,
        staked,
        profit,
        roi: staked > 0 ? profit / staked : undefined,
        averageClv: clvs.length > 0 ? clvs.reduce((sum, clv) => sum + clv, 0) / clvs.length : undefined,
        beatClosing: clvs.length > 0 ? clvs.filter((clv) => clv > 0).length / clvs.length : undefined,
        maxDrawdown,
        finalBankroll: bankroll,
    };
}

/** The soft books' early prices as quotes for the scanner. */
export function quotesOf(match: PastMatch): PriceQuote[] {
    const updatedAt = new Date(0);
    return Object.entries(match.soft).flatMap(([prefix, prices]) =>
        OUTCOMES.map((selection) => ({
            bookmaker: SOFT_BOOKS[prefix as keyof typeof SOFT_BOOKS],
            selection,
            price: prices[selection],
            updatedAt,
        })),
    );
}

function toRecord([home = 0, draw = 0, away = 0]: number[]): Prices {
    return { home, draw, away };
}
