import { describe, expect, it } from "vitest";
import { impliedProbability, overround } from "../odds.ts";

describe("impliedProbability", () => {
    it("inverts decimal odds", () => {
        expect(impliedProbability(2)).toBe(0.5);
        expect(impliedProbability(4)).toBe(0.25);
    });

    it.each([1, 0.5, 0, -2, Number.NaN, Number.POSITIVE_INFINITY])("rejects %s", (odds) => {
        expect(() => impliedProbability(odds)).toThrow(RangeError);
    });
});

describe("overround", () => {
    it("is zero for a fair market", () => {
        expect(overround([2, 2])).toBeCloseTo(0);
    });

    it("measures the margin of a 1X2 market", () => {
        expect(overround([2.1, 3.4, 3.6])).toBeCloseTo(0.0481, 4);
    });
});
