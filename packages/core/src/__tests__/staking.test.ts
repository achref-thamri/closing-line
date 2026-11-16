import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { keptEdge, kellyFraction, kellyStake, scannerStake, type StakeRules } from "../staking.ts";

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

    it("stakes Kelly on the edge a bet is likely to keep, not the edge seen", () => {
        // 2.00 against fair 1.82 is a 10% edge seen: Kelly on it would hit the 200 kr cap. Kept: 3.5%, so 2.00 is
        // treated as 3.5% above fair, a quarter-Kelly of 0.875%, 87 kr, rounded down to 80.
        expect(kellyStake(10_000, 2, 0.55, rules)).toBe(200);
        expect(scannerStake(10_000, 2, 0.55, rules)).toBe(80);
        // A 4% edge keeps 2.8%: 2.08 against fair 2.00, quarter-Kelly 0.65% of 30,000 kr is 195 kr, so 190.
        expect(scannerStake(30_000, 2.08, 0.5, rules)).toBe(190);
    });

    it("stakes nothing without an edge, or when the minimum would pass the bankroll cap", () => {
        expect(scannerStake(10_000, 2, 0.5, rules)).toBe(0);
        // 2% of 2,000 kr is 40 kr.
        expect(scannerStake(2_000, odds, fair, rules)).toBe(0);
    });
});

describe("kellyStake rounding", () => {
    it("doesn't lose a step to float error", () => {
        // Kelly 0.035 / 1.75 is 0.02 exactly, but 0.0199… in floating point.
        const whole = { ...rules, kellyMultiplier: 1, maxBankrollFraction: 1, minStake: 1, maxStake: 1_000, step: 1 };
        expect(kellyStake(1_000, 2.75, 1.035 / 2.75, whole)).toBe(20);
    });
});

describe("keptEdge", () => {
    it("keeps 70% of the edge seen, at most 3.5%", () => {
        expect(keptEdge(0.025)).toBeCloseTo(0.0175);
        expect(keptEdge(0.04)).toBeCloseTo(0.028);
        expect(keptEdge(0.1)).toBeCloseTo(0.035);
        expect(keptEdge(-0.01)).toBe(0);
    });
});
