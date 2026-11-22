import {
    closingLineValue,
    devigPower,
    findValueBets,
    kellyStake,
    OUTCOMES,
    outcomeOf,
    type Outcome,
    type PriceQuote,
    type StakeRules,
} from "@closing-line/core";
import { SOFT_BOOKS, SOFT_PREFIXES, type PastMatch, type Prices } from "./seasons.ts";

export interface BacktestOptions {
    minEdge: number;
    /** Leave out selections at these fair odds or longer, like the live scanner. */
    maxFairOdds?: number;
    /** Leave out offers whose full Kelly fraction is below this, like the live scanner. */
    minKellyFraction?: Readonly<Record<Outcome, number>>;
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
            ...(options.maxFairOdds === undefined ? {} : { maxFairOdds: options.maxFairOdds }),
            ...(options.minKellyFraction === undefined ? {} : { minKellyFraction: options.minKellyFraction }),
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

function quotesOf(match: PastMatch): PriceQuote[] {
    const updatedAt = new Date(0);
    return SOFT_PREFIXES.flatMap((prefix) => {
        const prices = match.soft[prefix];
        if (!prices) return [];
        return OUTCOMES.map((selection) => ({
            bookmaker: SOFT_BOOKS[prefix],
            selection,
            price: prices[selection],
            updatedAt,
        }));
    });
}

/** Home, draw and away from a three-way list; anything else is a bug upstream, so it throws. */
function toRecord(values: readonly number[]): Prices {
    const [home, draw, away] = values;
    if (values.length !== 3 || home === undefined || draw === undefined || away === undefined) {
        throw new RangeError(`expected home, draw and away, got ${values.length} values`);
    }
    return { home, draw, away };
}
