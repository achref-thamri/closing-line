import { describe, expect, it } from "vitest";
import { isOutcome, outcomeOf, settle1x2, toOutcome } from "../settlement.ts";

describe("outcomeOf", () => {
    it("reads the 1X2 outcome from the score", () => {
        expect(outcomeOf(2, 1)).toBe("home");
        expect(outcomeOf(1, 1)).toBe("draw");
        expect(outcomeOf(0, 3)).toBe("away");
    });
});

describe("settle1x2", () => {
    const bet = { selection: "home", stakeOre: 20_000, decimalOdds: 2.15 } as const;

    it("pays stake times net odds on a win", () => {
        expect(settle1x2(bet, { status: "finished", homeGoals: 2, awayGoals: 0 })).toEqual({
            status: "won",
            profitOre: 23_000,
        });
    });

    it("loses the stake otherwise", () => {
        expect(settle1x2(bet, { status: "finished", homeGoals: 1, awayGoals: 1 })).toEqual({
            status: "lost",
            profitOre: -20_000,
        });
    });

    it("returns the stake when the match is void", () => {
        expect(settle1x2(bet, { status: "void" })).toEqual({ status: "void", profitOre: 0 });
    });

    it("rounds winnings to whole øre", () => {
        expect(
            settle1x2(
                { selection: "draw", stakeOre: 1_000, decimalOdds: 3.333 },
                { status: "finished", homeGoals: 0, awayGoals: 0 },
            ),
        ).toEqual({ status: "won", profitOre: 2_333 });
    });
});

describe("toOutcome", () => {
    it("accepts the three 1X2 selections and nothing else", () => {
        expect(["home", "draw", "away"].map(toOutcome)).toEqual(["home", "draw", "away"]);
        expect(isOutcome("Arsenal")).toBe(false);
        expect(() => toOutcome("Arsenal")).toThrow(RangeError);
    });
});
