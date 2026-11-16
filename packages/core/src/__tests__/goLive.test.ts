import { describe, expect, it } from "vitest";
import { goLiveCheck, meanWithRange } from "../goLive.ts";

describe("meanWithRange", () => {
    it("gives the mean and a 95% range from the spread", () => {
        const range = meanWithRange([0.05, -0.01, 0.02, 0.04]);
        expect(range?.mean).toBeCloseTo(0.025);
        // sd 0.0265, so ±1.96 × 0.0265 / 2 = ±0.026
        expect(range?.low).toBeCloseTo(-0.001, 3);
        expect(range?.high).toBeCloseTo(0.051, 3);
        expect(meanWithRange([])).toBeUndefined();
        expect(meanWithRange([0.03])).toEqual({ mean: 0.03, low: undefined, high: undefined, count: 1 });
    });
});

describe("goLiveCheck", () => {
    const start = new Date("2026-11-01T12:00:00Z");
    const day = (n: number) => new Date(start.getTime() + n * 86_400_000);
    const bet = (n: number, profitOre: number, clv: number | null, status = profitOre > 0 ? "won" : "lost") => ({
        status,
        stakeOre: 10_000,
        profitOre,
        clv,
        createdAt: day(n),
        settledAt: day(n + 1),
    });

    it("ticks nothing early on and says how far each rule is", () => {
        const check = goLiveCheck({
            bets: [bet(0, 10_000, 0.03), bet(1, -10_000, 0.01), bet(2, 0, null, "void")],
            benchmarkRoi: -0.02,
            startingBankrollOre: 1_000_000,
            now: day(15),
        });
        expect(check.settled).toBe(2);
        expect(check.items.map((item) => [item.key, item.passed])).toEqual([
            ["bets", false],
            ["months", false],
            ["clv", true],
            ["benchmark", true],
            ["drawdown", true],
        ]);
        expect(check.ready).toBe(false);
        expect(check.roi).toBe(0);
    });

    it("measures drawdown from the starting bankroll and passes once every rule holds", () => {
        const losing = Array.from({ length: 31 }, (_, i) => bet(i, -10_000, -0.01));
        expect(
            goLiveCheck({ bets: losing, benchmarkRoi: 0, startingBankrollOre: 1_000_000, now: day(40) }).items.find(
                (item) => item.key === "drawdown",
            )?.passed,
        ).toBe(false);

        const good = Array.from({ length: 300 }, (_, i) => bet(i % 100, i % 2 === 0 ? 11_000 : -10_000, 0.02));
        const check = goLiveCheck({ bets: good, benchmarkRoi: -0.03, startingBankrollOre: 1_000_000, now: day(100) });
        expect(check.ready).toBe(true);
    });
});
