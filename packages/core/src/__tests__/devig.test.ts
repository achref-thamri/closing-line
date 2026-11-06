import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { devigPower } from "../devig.ts";

const sum = (values: readonly number[]) => values.reduce((total, value) => total + value, 0);
const market = fc.array(fc.double({ min: 1.01, max: 50, noNaN: true }), { minLength: 2, maxLength: 3 });

describe("devigPower", () => {
    const devig = devigPower;
    it("returns probabilities that sum to one", () => {
        fc.assert(fc.property(market, (odds) => Math.abs(sum(devig(odds)) - 1) < 1e-9));
    });

    it("keeps shorter odds more likely", () => {
        fc.assert(
            fc.property(market, (odds) => {
                const fair = devig(odds);
                return odds.every((a, i) => odds.every((b, j) => !(a < b) || (fair[i] ?? 0) >= (fair[j] ?? 0)));
            }),
        );
    });

    it("leaves a fair market unchanged", () => {
        const fair = devig([2, 4, 4]);
        expect(fair[0]).toBeCloseTo(0.5);
        expect(fair[1]).toBeCloseTo(0.25);
        expect(fair[2]).toBeCloseTo(0.25);
    });

    it("takes more margin off longshots than spreading it in proportion", () => {
        const odds = [2.1, 3.4, 3.6];
        const power = devigPower(odds);
        const total = odds.reduce((sum, price) => sum + 1 / price, 0);
        const proportional = odds.map((price) => 1 / price / total);
        expect(power[0]).toBeCloseTo(0.4602, 4);
        expect(power[2]).toBeCloseTo(0.2618, 4);
        expect(power[0]).toBeGreaterThan(proportional[0] ?? 1);
        expect(power[2]).toBeLessThan(proportional[2] ?? 0);
    });

    it("handles a market priced below 100%, as best odds across books can be", () => {
        expect(sum(devigPower([2.2, 3.7, 3.9]))).toBeCloseTo(1);
    });

    it("rejects a market with one outcome", () => {
        expect(() => devigPower([1.5])).toThrow(RangeError);
    });
});
