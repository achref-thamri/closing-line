import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { MetricsBet } from "../metrics.ts";
import {
    cashoutGainOre,
    groupPositions,
    heldProfitOre,
    impliedOddsFromCashout,
    positionKey,
    priceMove,
    skew,
    statsBy,
    type PositionBet,
} from "../slips.ts";

describe("heldProfitOre", () => {
    const bet = { stakeOre: 150_000, lockedOdds: 3.7 };

    it("pays stake times net odds on a win, loses the stake, returns it when void", () => {
        expect(heldProfitOre(bet, "won")).toBe(405_000);
        expect(heldProfitOre(bet, "lost")).toBe(-150_000);
        expect(heldProfitOre(bet, "void")).toBe(0);
    });
});

describe("impliedOddsFromCashout", () => {
    it("reads the bookmaker's new price from the offer", () => {
        // 1,660 kr at 3.10 cashed out for 2,557.17 kr: the bookmaker's price had fallen to about 2.01.
        expect(impliedOddsFromCashout({ stakeOre: 166_000, lockedOdds: 3.1 }, 255_717)).toBeCloseTo(2.012, 3);
    });

    it("is undefined when the offer is not a usable price", () => {
        const bet = { stakeOre: 100_000, lockedOdds: 3 };
        expect(impliedOddsFromCashout(bet, 0)).toBeUndefined();
        expect(impliedOddsFromCashout(bet, 300_000)).toBeUndefined();
        expect(impliedOddsFromCashout(bet, 400_000)).toBeUndefined();
    });

    it("gives back the price a fair cash-out was computed from", () => {
        fc.assert(
            fc.property(
                fc.integer({ min: 1_000, max: 1_000_000 }),
                fc.double({ min: 1.05, max: 50, noNaN: true }),
                fc.double({ min: 1.05, max: 50, noNaN: true }),
                (stakeOre, lockedOdds, currentOdds) => {
                    const offerOre = (stakeOre * lockedOdds) / currentOdds;
                    expect(impliedOddsFromCashout({ stakeOre, lockedOdds }, offerOre)).toBeCloseTo(currentOdds, 6);
                },
            ),
        );
    });
});

describe("priceMove and skew", () => {
    it("is positive when the bookmaker cut the price after the bet", () => {
        expect(priceMove(3.1, 2.012)).toBeCloseTo(0.5408, 4);
        expect(priceMove(2, 2.5)).toBeCloseTo(-0.2);
    });

    it("compares the odds taken with the other books' price", () => {
        expect(skew(3.1, 1.4)).toBeCloseTo(1.2143, 4);
    });
});

describe("cashoutGainOre", () => {
    const bet = { stakeOre: 166_000, lockedOdds: 3.1, cashoutOfferOre: 255_717 };

    it("is negative when the selection went on to win", () => {
        // Holding would have paid 5,146 kr: cashing out gave up 2,588.83 kr.
        expect(cashoutGainOre(bet, "won")).toBe(-258_883);
    });

    it("is the whole cash-out when the selection went on to lose", () => {
        expect(cashoutGainOre(bet, "lost")).toBe(255_717);
        expect(cashoutGainOre(bet, "void")).toBe(89_717);
    });
});

describe("positions", () => {
    const base: PositionBet = {
        playerId: "friend",
        fixtureId: null,
        eventName: "Bayern München – Borussia Dortmund",
        market: "player_shots_on_target",
        playerName: "Jobe Bellingham",
        selection: "over",
    };

    it("puts laddered lines on one player in one position", () => {
        const spelledDifferently = {
            ...base,
            eventName: " bayern munchen –  borussia dortmund",
            playerName: "JOBE BELLINGHAM",
        };
        expect(positionKey(spelledDifferently)).toBe(positionKey(base));
    });

    it("keeps other players, markets, matches and bettors apart", () => {
        const keys = [
            base,
            { ...base, playerName: "Serhou Guirassy" },
            { ...base, market: "player_fouls" },
            { ...base, eventName: "Bayern München – Arsenal" },
            { ...base, playerId: "owner" },
            { ...base, fixtureId: "evt1" },
        ].map(positionKey);
        expect(new Set(keys).size).toBe(keys.length);
    });

    it("uses the selection when the bet is not on a player", () => {
        const winner = { ...base, eventName: "Aurora – Team Liquid", market: "winner", playerName: null };
        expect(positionKey({ ...winner, selection: "Team Liquid" })).not.toBe(
            positionKey({ ...winner, selection: "Aurora" }),
        );
    });

    it("groups bets in order of first appearance", () => {
        const davies = { ...base, eventName: "Bayern München – Arsenal", playerName: "Alphonso Davies" };
        const groups = groupPositions([
            { ...base, id: 1 },
            { ...davies, id: 2 },
            { ...base, id: 3 },
        ]);
        expect(groups.map((group) => group.map((bet) => bet.id))).toEqual([[1, 3], [2]]);
    });
});

describe("statsBy", () => {
    const bet = (tag: string | null, status: MetricsBet["status"], stakeOre: number, profitOre: number | null) => ({
        tag,
        status,
        stakeOre,
        profitOre,
        settledAt: status === "open" ? null : new Date("2026-11-08T18:00:00Z"),
        clv: null,
    });

    it("computes results per group and counts cash-outs as settled", () => {
        const stats = statsBy(
            [
                bet("lineup", "won", 150_000, 405_000),
                bet("lineup", "cashed_out", 166_000, 89_717),
                bet("game_read", "lost", 240_000, -240_000),
                bet(null, "won", 10_000, 10_000),
            ],
            (row) => row.tag,
        );
        expect([...stats.keys()]).toEqual(["lineup", "game_read"]);
        expect(stats.get("lineup")).toMatchObject({ settled: 2, won: 1, stakedOre: 316_000, profitOre: 494_717 });
        expect(stats.get("game_read")?.roi).toBe(-1);
    });
});
