import { describe, expect, it } from "vitest";
import { closingLineValue, edge, tipLifetime } from "../value.ts";

describe("edge", () => {
    it("is the expected profit per unit staked", () => {
        expect(edge(2.3, 1 / 2.1)).toBeCloseTo(0.0952, 4);
        expect(edge(2, 0.5)).toBeCloseTo(0);
        expect(edge(1.9, 0.5)).toBeCloseTo(-0.05);
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
