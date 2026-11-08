import { describe, expect, it } from "vitest";
import { kellyFraction } from "../staking.ts";
import { closingLineValue, edge, minimumOdds, tipLifetime } from "../value.ts";

describe("edge", () => {
    it("is the expected profit per unit staked", () => {
        expect(edge(2.3, 1 / 2.1)).toBeCloseTo(0.0952, 4);
        expect(edge(2, 0.5)).toBeCloseTo(0);
        expect(edge(1.9, 0.5)).toBeCloseTo(-0.05);
    });
});

describe("minimumOdds", () => {
    it("rounds up, so the price it names still clears the edge", () => {
        expect(minimumOdds(2.54, 0.02)).toBe(2.6);
        expect(edge(2.6, 1 / 2.54)).toBeGreaterThanOrEqual(0.02);
        expect(edge(2.59, 1 / 2.54)).toBeLessThan(0.02);
    });

    it("keeps an exact price as it is", () => {
        expect(minimumOdds(2, 0.05)).toBe(2.1);
    });

    it("asks for more edge at longer odds when Kelly sets a floor", () => {
        // Kelly's 2% floor binds above the 2% edge at both prices, and much harder at 4.0 than at 2.0.
        expect(minimumOdds(2, 0.02, 0.02)).toBe(2.05);
        expect(minimumOdds(4, 0.02, 0.02)).toBe(4.27);
        expect(kellyFraction(4.27, 1 / 4)).toBeGreaterThanOrEqual(0.02);
        expect(kellyFraction(4.26, 1 / 4)).toBeLessThan(0.02);
        // At short odds the edge rule is the larger one.
        expect(minimumOdds(1.2, 0.02, 0.02)).toBe(minimumOdds(1.2, 0.02));
    });
});

describe("closingLineValue", () => {
    it("is positive when the bet beat the closing price", () => {
        expect(closingLineValue(2.3, 2.1)).toBeCloseTo(0.0952, 4);
        expect(closingLineValue(2, 2.2)).toBeCloseTo(-0.0909, 4);
    });
});

describe("tipLifetime", () => {
    const sentAt = new Date("2026-11-07T08:00:00Z");
    const at = (hours: number) => new Date(sentAt.getTime() + hours * 3_600_000);

    it("checks the next poll and the pre-kickoff poll against the tip's odds", () => {
        const later = [
            { price: 2.45, takenAt: at(9), kind: "closing" },
            { price: 2.5, takenAt: at(3), kind: "poll" },
            { price: 2.6, takenAt: at(-1), kind: "poll" },
        ];
        expect(tipLifetime({ odds: 2.5, sentAt }, later)).toEqual({ nextPoll: true, atClosing: false });
    });

    it("knows nothing before a later poll, and takes the last pre-kickoff price", () => {
        expect(tipLifetime({ odds: 2.5, sentAt }, [])).toEqual({ nextPoll: undefined, atClosing: undefined });
        const twoClosing = [
            { price: 2.4, takenAt: at(8.8), kind: "closing" },
            { price: 2.5, takenAt: at(8.9), kind: "closing" },
        ];
        expect(tipLifetime({ odds: 2.5, sentAt }, twoClosing)).toEqual({ nextPoll: false, atClosing: true });
    });
});
