import { describe, expect, it } from "vitest";
import { playerStats, type MetricsBet } from "../metrics.ts";

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
