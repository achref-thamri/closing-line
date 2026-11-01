import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { crossedUsageLevels, dailyAllowance, daysLeftInMonth, decideCredits, type CreditState } from "../credits.ts";

const RESERVE = 50;
// 30 days left with 500 at the start of the day: (500 - 50) / 30 = 15 credits a day for polls.
const fresh: CreditState = { remaining: 500, remainingAtDayStart: 500, daysLeft: 30 };

describe("decideCredits", () => {
    it("lets polls spend the daily allowance and no more", () => {
        expect(dailyAllowance(fresh, RESERVE)).toBe(15);
        expect(decideCredits({ ...fresh, remaining: 486 }, 1, "scan", RESERVE)).toEqual({ allowed: true });
        expect(decideCredits({ ...fresh, remaining: 485 }, 1, "scan", RESERVE)).toEqual({
            allowed: false,
            reason: "daily allowance of 15 credits used (15 spent today)",
        });
    });

    it("lets closing snapshots go past the daily allowance but not into the reserve", () => {
        expect(decideCredits({ ...fresh, remaining: 400 }, 1, "closing", RESERVE).allowed).toBe(true);
        expect(decideCredits({ ...fresh, remaining: 50 }, 1, "closing", RESERVE)).toEqual({
            allowed: false,
            reason: "would dip into the 50-credit reserve",
        });
    });

    it("lets a human bet use the reserve, down to zero", () => {
        expect(decideCredits({ ...fresh, remaining: 1 }, 1, "bet", RESERVE).allowed).toBe(true);
        expect(decideCredits({ ...fresh, remaining: 0 }, 1, "bet", RESERVE)).toEqual({
            allowed: false,
            reason: "no credits left this month",
        });
    });

    it("spreads what is left over the remaining days", () => {
        expect(dailyAllowance({ remaining: 150, remainingAtDayStart: 150, daysLeft: 5 }, RESERVE)).toBe(20);
        expect(dailyAllowance({ remaining: 40, remainingAtDayStart: 40, daysLeft: 5 }, RESERVE)).toBe(0);
        expect(dailyAllowance({ remaining: 450, remainingAtDayStart: 450, daysLeft: 0 }, RESERVE)).toBe(400);
    });

    it("never lets automated calls end below the reserve or past the allowance", () => {
        fc.assert(
            fc.property(
                fc.integer({ min: 0, max: 20_000 }),
                fc.integer({ min: 0, max: 20_000 }),
                fc.integer({ min: 1, max: 31 }),
                fc.integer({ min: 1, max: 10 }),
                fc.constantFrom("scan" as const, "closing" as const),
                (remaining, spent, daysLeft, cost, priority) => {
                    const state = { remaining, remainingAtDayStart: remaining + spent, daysLeft };
                    if (!decideCredits(state, cost, priority, RESERVE).allowed) return true;
                    const withinAllowance = priority === "closing" || spent + cost <= dailyAllowance(state, RESERVE);
                    return remaining - cost >= RESERVE && withinAllowance;
                },
            ),
        );
    });
});

describe("crossedUsageLevels", () => {
    it("reports each level once, when usage passes it", () => {
        expect(crossedUsageLevels({ used: 349, remaining: 151 }, { used: 350, remaining: 150 }, [0.7, 0.9])).toEqual([
            0.7,
        ]);
        expect(crossedUsageLevels({ used: 350, remaining: 150 }, { used: 351, remaining: 149 }, [0.7, 0.9])).toEqual(
            [],
        );
        expect(crossedUsageLevels({ used: 300, remaining: 200 }, { used: 460, remaining: 40 }, [0.7, 0.9])).toEqual([
            0.7, 0.9,
        ]);
    });

    it("handles an account with no quota information", () => {
        expect(crossedUsageLevels({ used: 0, remaining: 0 }, { used: 0, remaining: 0 }, [0.7])).toEqual([]);
    });
});

describe("daysLeftInMonth", () => {
    it("counts today until the first of next month", () => {
        expect(daysLeftInMonth(new Date("2026-11-01T00:00:00Z"))).toBe(30);
        expect(daysLeftInMonth(new Date("2026-11-30T23:59:59Z"))).toBe(1);
        expect(daysLeftInMonth(new Date("2026-12-31T12:00:00Z"))).toBe(1);
        expect(daysLeftInMonth(new Date("2028-02-01T12:00:00Z"))).toBe(29);
    });
});
