import { describe, expect, it } from "vitest";
import { impliedProbability } from "../odds.ts";

describe("impliedProbability", () => {
    it("inverts decimal odds", () => {
        expect(impliedProbability(2)).toBe(0.5);
        expect(impliedProbability(4)).toBe(0.25);
    });

    it.each([1, 0.5, 0, -2, Number.NaN, Number.POSITIVE_INFINITY])("rejects %s", (odds) => {
        expect(() => impliedProbability(odds)).toThrow(RangeError);
    });
});
