import type { Bet, BetWithFixture } from "./bets.ts";

/**
 * A complete open scanner bet for tests: home at 2.10 on a tracked fixture, 100 kr. Tests override what they check,
 * so every field has a real value and nothing needs a cast.
 */
export function testBet(overrides: Partial<Bet> = {}): Bet {
    return {
        id: "00000000-0000-7000-8000-000000000001",
        playerId: "scanner",
        fixtureId: "f".repeat(32),
        sport: "football",
        eventName: null,
        market: "h2h",
        selection: "home",
        playerName: null,
        line: null,
        stakeOre: 10_000,
        lockedOdds: 2.1,
        bookmaker: "unibet_se",
        sharpFairOddsAtBet: 2.0,
        edgeAtBet: 0.05,
        selfReported: false,
        tag: null,
        receivedAt: null,
        cashoutOfferOre: null,
        impliedCurrentOdds: null,
        heldStatus: null,
        status: "open",
        closingFairOdds: null,
        closingProvisional: null,
        clv: null,
        priceGoneAt: null,
        profitOre: null,
        createdAt: new Date("2026-11-01T10:00:00Z"),
        settledAt: null,
        ...overrides,
    };
}

/** `testBet` with its fixture, as the dashboard reads it. Pass `fixture: null` for an untracked event. */
export function testBetWithFixture(overrides: Partial<BetWithFixture> = {}): BetWithFixture {
    return {
        ...testBet(),
        fixture: {
            homeTeam: "Nice",
            awayTeam: "Paris Saint Germain",
            kickoff: new Date("2026-11-21T15:00:00Z"),
            league: "soccer_france_ligue_one",
        },
        ...overrides,
    };
}
