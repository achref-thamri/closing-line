import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { kellyFraction, kellyStake, scannerStake, type StakeRules } from "../staking.ts";

const rules: StakeRules = { kellyMultiplier: 0.25, maxBankrollFraction: 0.02, minStake: 50, maxStake: 500, step: 10 };

describe("kellyFraction", () => {
    it("stakes edge over net odds", () => {
        expect(kellyFraction(2, 0.55)).toBeCloseTo(0.1);
    });

    it("is zero without an edge", () => {
        expect(kellyFraction(2, 0.5)).toBe(0);
        expect(kellyFraction(2, 0.4)).toBe(0);
    });
});

describe("kellyStake", () => {
    it("uses fractional Kelly rounded down to the step", () => {
        // Full Kelly 6.25%, quarter 1.5625% of 10,000 = 156.25
        expect(kellyStake(10_000, 2.6, 0.4231, rules)).toBe(150);
    });

    it("caps at the bankroll share and the maximum stake", () => {
        expect(kellyStake(10_000, 2, 0.7, rules)).toBe(200);
        expect(kellyStake(100_000, 2, 0.7, rules)).toBe(500);
    });

    it("skips bets below the minimum stake", () => {
        expect(kellyStake(10_000, 2, 0.505, rules)).toBe(0);
    });

    it("never stakes outside the limits", () => {
        fc.assert(
            fc.property(
                fc.double({ min: 0, max: 1_000_000, noNaN: true }),
                fc.double({ min: 1.01, max: 50, noNaN: true }),
                fc.double({ min: 0, max: 1, noNaN: true }),
                (bankroll, odds, probability) => {
                    const stake = kellyStake(bankroll, odds, probability, rules);
                    return (
                        stake === 0 ||
                        (stake >= rules.minStake &&
                            stake <= rules.maxStake &&
                            stake <= bankroll * rules.maxBankrollFraction &&
                            stake % rules.step === 0)
                    );
                },
            ),
        );
    });
});

describe("scannerStake", () => {
    // 3.40 against fair 3.33 is a 2.1% edge: quarter-Kelly is about 22 kr on 10,000 kr.
    const odds = 3.4;
    const fair = 1 / 3.33;

    it("raises a stake Kelly rounds below the minimum to the minimum", () => {
        expect(kellyStake(10_000, odds, fair, rules)).toBe(0);
        expect(scannerStake(10_000, odds, fair, rules)).toBe(50);
    });

    it("keeps Kelly's stake when it clears the minimum", () => {
        expect(scannerStake(10_000, 2, 0.55, rules)).toBe(kellyStake(10_000, 2, 0.55, rules));
    });

    it("stakes nothing without an edge, or when the minimum would pass the bankroll cap", () => {
        expect(scannerStake(10_000, 2, 0.5, rules)).toBe(0);
        // 2% of 2,000 kr is 40 kr.
        expect(scannerStake(2_000, odds, fair, rules)).toBe(0);
    });
});
