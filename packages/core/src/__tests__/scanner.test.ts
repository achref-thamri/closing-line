import { describe, expect, it } from "vitest";
import {
    fairProbabilities,
    favourite,
    findValueBets,
    meetsScannerRules,
    netOdds,
    type PriceQuote,
} from "../scanner.ts";

const now = new Date("2026-11-01T12:00:00Z");
const fresh = new Date("2026-11-01T11:58:00Z");
const quote = (
    bookmaker: string,
    selection: PriceQuote["selection"],
    price: number,
    updatedAt = fresh,
): PriceQuote => ({
    bookmaker,
    selection,
    price,
    updatedAt,
});
// Liverpool v Arsenal, 1 November 2026.
const pinnacle = [quote("pinnacle", "home", 2.96), quote("pinnacle", "draw", 3.43), quote("pinnacle", "away", 2.47)];
const options = { sharpBookmaker: "pinnacle", commission: { betfair_ex_eu: 0.05 }, minEdge: 0.03 };
const TEN_MINUTES = 10 * 60_000;

describe("fairProbabilities", () => {
    it("removes the sharp bookmaker's margin", () => {
        const fair = fairProbabilities(pinnacle, "pinnacle", now, TEN_MINUTES);
        expect(fair).toBeDefined();
        expect((fair?.home ?? 0) + (fair?.draw ?? 0) + (fair?.away ?? 0)).toBeCloseTo(1);
        expect(fair?.away).toBeGreaterThan(fair?.home ?? 1);
    });

    it("refuses a stale or incomplete sharp market", () => {
        const stale = [...pinnacle.slice(0, 2), quote("pinnacle", "away", 2.47, new Date("2026-11-01T11:45:00Z"))];
        expect(fairProbabilities(stale, "pinnacle", now, TEN_MINUTES)).toBeUndefined();
        expect(fairProbabilities(pinnacle.slice(0, 2), "pinnacle", now, TEN_MINUTES)).toBeUndefined();
    });
});

describe("findValueBets", () => {
    const fair = { home: 0.33, draw: 0.28, away: 0.39 };

    it("picks the best bookmaker per selection above the threshold", () => {
        const bets = findValueBets(
            [
                ...pinnacle,
                quote("unibet_se", "away", 2.7),
                quote("betsson", "away", 2.65),
                quote("unibet_se", "home", 3.0),
            ],
            fair,
            options,
        );
        expect(bets).toHaveLength(1);
        expect(bets[0]).toMatchObject({ selection: "away", bookmaker: "unibet_se", offeredOdds: 2.7, netOdds: 2.7 });
        expect(bets[0]?.edge).toBeCloseTo(2.7 * 0.39 - 1);
        expect(bets[0]?.fairOdds).toBeCloseTo(1 / 0.39);
        // Every book above the threshold is offered, best first, so each person can use a book they have.
        expect(bets[0]?.offers.map((offer) => [offer.bookmaker, offer.offeredOdds])).toEqual([
            ["unibet_se", 2.7],
            ["betsson", 2.65],
        ]);
    });

    it("takes exchange commission off before judging value", () => {
        // 2.75 looks like 7% value, but after 5% commission it pays 2.6625: 3.8%.
        const [bet] = findValueBets([quote("betfair_ex_eu", "away", 2.75)], fair, options);
        expect(bet?.netOdds).toBeCloseTo(2.6625);
        expect(bet?.edge).toBeCloseTo(2.6625 * 0.39 - 1);
        expect(findValueBets([quote("betfair_ex_eu", "away", 2.7)], fair, options)).toEqual([]);
    });

    it("never bets against the sharp bookmaker itself", () => {
        expect(findValueBets([quote("pinnacle", "away", 3.0)], fair, options)).toEqual([]);
    });

    it("leaves out offers whose Kelly fraction is under the floor", () => {
        // Both are about 5% edges; at 2.15 Kelly is 4.7%, at 2.73 only 2.9%. A 3% floor keeps the first.
        const even = { home: 0.49, draw: 0.13, away: 0.385 };
        const quotes = [quote("unibet_se", "home", 2.15), quote("unibet_se", "away", 2.73)];
        expect(findValueBets(quotes, even, options).map((bet) => bet.selection)).toEqual(["home", "away"]);
        expect(
            findValueBets(quotes, even, { ...options, minKellyFraction: { home: 0.03, draw: 0.03, away: 0.03 } }).map(
                (bet) => bet.selection,
            ),
        ).toEqual(["home"]);
    });

    it("leaves out outsiders at the fair-odds cap or longer", () => {
        // Fair odds 1/0.2 = 5 for the draw, 1/0.5 = 2 for home; both have 10% edge at these prices.
        const outsider = { home: 0.5, draw: 0.2, away: 0.3 };
        const quotes = [quote("unibet_se", "home", 2.2), quote("unibet_se", "draw", 5.5)];
        expect(findValueBets(quotes, outsider, options).map((bet) => bet.selection)).toEqual(["home", "draw"]);
        expect(findValueBets(quotes, outsider, { ...options, maxFairOdds: 5 }).map((bet) => bet.selection)).toEqual([
            "home",
        ]);
    });
});

describe("netOdds", () => {
    it("keeps the stake and cuts only the winnings", () => {
        expect(netOdds(3, 0.05)).toBeCloseTo(2.9);
        expect(netOdds(3, 0)).toBe(3);
    });
});

describe("favourite", () => {
    it("is the shortest sharp price", () => {
        expect(favourite([...pinnacle, quote("unibet_se", "home", 1.5)], "pinnacle")).toMatchObject({
            selection: "away",
            price: 2.47,
        });
    });

    it("needs the full market", () => {
        expect(favourite(pinnacle.slice(1), "pinnacle")).toBeUndefined();
    });
});

describe("meetsScannerRules", () => {
    const rules = {
        maxHoursToKickoff: 72,
        closingWindowMinutes: 45,
        maxFairOdds: 5,
        minKellyFraction: { home: 0.02, draw: 0.01, away: 0.02 },
    };
    const kickoff = new Date("2026-11-21T15:00:00Z");
    const hoursBefore = (hours: number) => new Date(kickoff.getTime() - hours * 3_600_000);
    const bet = { createdAt: hoursBefore(10), selection: "home", lockedOdds: 2.17, sharpFairOddsAtBet: 2.07 };

    it("passes a bet today's scanner would still place", () => {
        expect(meetsScannerRules(bet, kickoff, rules)).toBe(true);
    });

    it("fails a bet placed too far out or in the closing window, on an outsider, or with too small a Kelly fraction", () => {
        expect(meetsScannerRules({ ...bet, createdAt: hoursBefore(17 * 24) }, kickoff, rules)).toBe(false);
        // Placed by the pre-kickoff poll, which also sets the closing price.
        expect(meetsScannerRules({ ...bet, createdAt: hoursBefore(0.25) }, kickoff, rules)).toBe(false);
        expect(meetsScannerRules({ ...bet, lockedOdds: 7.5, sharpFairOddsAtBet: 6.44 }, kickoff, rules)).toBe(false);
        // 2.47 against 2.42 fair is a 2.1% edge but a Kelly fraction of only 1.4%.
        expect(meetsScannerRules({ ...bet, lockedOdds: 2.47, sharpFairOddsAtBet: 2.42 }, kickoff, rules)).toBe(false);
        expect(
            meetsScannerRules({ ...bet, selection: "draw", lockedOdds: 3.65, sharpFairOddsAtBet: 3.5 }, kickoff, rules),
        ).toBe(true);
    });

    it("can't judge a bet without a fair price or a 1X2 selection, so leaves it in", () => {
        expect(meetsScannerRules({ ...bet, sharpFairOddsAtBet: null }, kickoff, rules)).toBe(true);
        expect(meetsScannerRules({ ...bet, selection: "over" }, kickoff, rules)).toBe(true);
    });
});
