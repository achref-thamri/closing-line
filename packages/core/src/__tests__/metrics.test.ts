import { describe, expect, it } from "vitest";
import {
    availableFromTotals,
    bankrollSeries,
    playerStats,
    statsFromTotals,
    totalsOf,
    type MetricsBet,
} from "../metrics.ts";

const settledAt = new Date("2026-11-08T18:00:00Z");
const bet = (
    status: MetricsBet["status"],
    stakeOre: number,
    profitOre: number | null,
    clv: number | null,
): MetricsBet => ({
    status,
    stakeOre,
    profitOre,
    clv,
    settledAt: status === "open" ? null : settledAt,
});

describe("playerStats", () => {
    it("sums results, ROI and average CLV", () => {
        const stats = playerStats([
            bet("won", 10_000, 15_000, 0.05),
            bet("lost", 20_000, -20_000, -0.01),
            bet("void", 5_000, 0, null),
            bet("open", 12_000, null, 0.02),
        ]);
        expect(stats).toEqual({
            settled: 2,
            won: 1,
            void: 1,
            open: 1,
            stakedOre: 30_000,
            profitOre: -5_000,
            roi: -5_000 / 30_000,
            averageClv: 0.02,
        });
    });

    it("has no ROI or CLV before the first bet", () => {
        expect(playerStats([])).toMatchObject({ settled: 0, roi: undefined, averageClv: undefined });
    });
});

describe("bankrollSeries", () => {
    it("adds each settled bet in settlement order", () => {
        const start = new Date("2026-11-01T00:00:00Z");
        const late = { ...bet("lost", 20_000, -20_000, null), settledAt: new Date("2026-11-09T18:00:00Z") };
        const series = bankrollSeries(1_000_000, start, [
            late,
            bet("won", 10_000, 15_000, null),
            bet("open", 5_000, null, null),
        ]);
        expect(series).toEqual([
            { at: start, bankrollOre: 1_000_000 },
            { at: settledAt, bankrollOre: 1_015_000 },
            { at: late.settledAt, bankrollOre: 995_000 },
        ]);
    });

    it("starts no later than the first settlement", () => {
        const series = bankrollSeries(1_000_000, new Date("2026-12-01T00:00:00Z"), [bet("won", 10_000, 15_000, null)]);
        expect(series[0]).toEqual({ at: settledAt, bankrollOre: 1_000_000 });
    });
});

describe("totals", () => {
    it("give the same stats as the bets they sum", () => {
        const bets = [
            bet("won", 10_000, 15_000, 0.05),
            bet("lost", 20_000, -20_000, -0.01),
            bet("open", 12_000, null, 0.02),
            bet("cashed_out", 5_000, 9_000, null),
        ];
        const totals = totalsOf(bets);
        expect(totals).toMatchObject({ openStakeOre: 12_000, clvSum: 0.06, clvCount: 3 });
        expect(statsFromTotals(totals)).toEqual(playerStats(bets));
        expect(availableFromTotals(1_000_000, totals)).toBe(1_000_000 - 5_000 + 9_000 - 12_000);
    });
});
