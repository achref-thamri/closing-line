import { devigPower } from "./devig.ts";
import { OUTCOMES, type Outcome } from "./settlement.ts";
import { kellyFraction } from "./staking.ts";
import { edge } from "./value.ts";

export interface PriceQuote {
    bookmaker: string;
    selection: Outcome;
    price: number;
    updatedAt: Date;
}

/** One bookmaker's price that clears the value threshold. */
export interface ValueOffer {
    bookmaker: string;
    offeredOdds: number;
    netOdds: number;
    edge: number;
}

export interface ValueBet {
    selection: Outcome;
    bookmaker: string;
    /** The price on offer. */
    offeredOdds: number;
    /** The price after exchange commission on winnings: what the bet really pays. */
    netOdds: number;
    fairProbability: number;
    fairOdds: number;
    edge: number;
    /** Every bookmaker that clears the threshold, best first; the best one is the bet itself. */
    offers: ValueOffer[];
}

/**
 * Fair 1X2 probabilities from the sharp bookmaker, or nothing when it does not price all three outcomes or a
 * price is older than `maxAgeMs` (a stale sharp price would show value that is not there).
 */
export function fairProbabilities(
    quotes: readonly PriceQuote[],
    sharpBookmaker: string,
    now: Date,
    maxAgeMs: number,
): Record<Outcome, number> | undefined {
    const sharp = OUTCOMES.map((selection) =>
        quotes.find((quote) => quote.bookmaker === sharpBookmaker && quote.selection === selection),
    );
    if (sharp.some((quote) => !quote || now.getTime() - quote.updatedAt.getTime() > maxAgeMs)) return undefined;
    const [home = 0, draw = 0, away = 0] = devigPower(sharp.map((quote) => quote?.price ?? 0));
    return { home, draw, away };
}

/** Odds after commission on net winnings, as paid by an exchange. */
export function netOdds(price: number, commission: number): number {
    return 1 + (price - 1) * (1 - commission);
}

/**
 * Per selection, the bookmakers whose edge reaches `minEdge` and whose Kelly fraction reaches `minKellyFraction`;
 * the bet is at the best one. Selections whose fair odds reach `maxFairOdds` are left out.
 */
export function findValueBets(
    quotes: readonly PriceQuote[],
    fair: Record<Outcome, number>,
    options: {
        sharpBookmaker: string;
        commission: Readonly<Record<string, number>>;
        minEdge: number;
        maxFairOdds?: number;
        minKellyFraction?: number;
    },
): ValueBet[] {
    const bets: ValueBet[] = [];
    for (const selection of OUTCOMES) {
        const fairProbability = fair[selection];
        if (options.maxFairOdds !== undefined && 1 / fairProbability >= options.maxFairOdds) continue;
        const offers: ValueOffer[] = [];
        for (const quote of quotes) {
            if (quote.selection !== selection || quote.bookmaker === options.sharpBookmaker) continue;
            const net = netOdds(quote.price, options.commission[quote.bookmaker] ?? 0);
            const value = edge(net, fairProbability);
            const kelly = kellyFraction(net, fairProbability);
            if (value >= options.minEdge && kelly >= (options.minKellyFraction ?? 0)) {
                offers.push({ bookmaker: quote.bookmaker, offeredOdds: quote.price, netOdds: net, edge: value });
            }
        }
        offers.sort((a, b) => b.edge - a.edge);
        const [best] = offers;
        if (best)
            bets.push({ selection, ...best, fairProbability, fairOdds: 1 / fairProbability, edge: best.edge, offers });
    }
    return bets;
}

/** The single best soft price against the fair price, on any selection, whether it reaches a threshold or not. */
export function bestOffer(
    quotes: readonly PriceQuote[],
    fair: Record<Outcome, number>,
    options: { sharpBookmaker: string; commission: Readonly<Record<string, number>> },
): ValueBet | undefined {
    const all = findValueBets(quotes, fair, { ...options, minEdge: -Infinity });
    return all.reduce<ValueBet | undefined>((best, bet) => (!best || bet.edge > best.edge ? bet : best), undefined);
}

/** The sharp bookmaker's favourite: the shortest price, or nothing without a full market. */
export function favourite(quotes: readonly PriceQuote[], sharpBookmaker: string): PriceQuote | undefined {
    const sharp = quotes.filter((quote) => quote.bookmaker === sharpBookmaker);
    if (OUTCOMES.some((selection) => !sharp.some((quote) => quote.selection === selection))) return undefined;
    return sharp.reduce((best, quote) => (quote.price < best.price ? quote : best));
}
