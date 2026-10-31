import { describe, expect, it } from "vitest";
import { closingLineValue, edge } from "../value.ts";

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
