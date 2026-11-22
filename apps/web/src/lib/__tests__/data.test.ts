import { describe, expect, it } from "vitest";
import { byClv, isRanked, MIN_CLV_BETS_TO_RANK, pageOf, runningClv } from "../data.ts";

describe("byClv", () => {
    const player = (id: string, averageClv: number | undefined, clvCount: number, growth = 0) => ({
        id,
        growth,
        stats: { averageClv, clvCount },
    });

    it("ranks players with enough closing prices by CLV, whatever their profit", () => {
        const scanner = player("scanner", 0.013, MIN_CLV_BETS_TO_RANK + 22, -0.05);
        const favourite = player("favourite", -0.017, MIN_CLV_BETS_TO_RANK + 40, 0.01);
        const lucky = player("friend", undefined, 0, 0.19);
        const fewClv = player("owner", 0.048, 1, 0.02);
        expect([lucky, favourite, fewClv, scanner].sort(byClv).map((entry) => entry.id)).toEqual([
            "scanner",
            "favourite",
            "owner",
            "friend",
        ]);
        expect(isRanked(scanner)).toBe(true);
        expect(isRanked(fewClv)).toBe(false);
    });

    it("orders unranked players by how close they are to ranking, then by growth", () => {
        const a = player("a", 0.1, MIN_CLV_BETS_TO_RANK - 20, 0);
        const b = player("b", 0.1, MIN_CLV_BETS_TO_RANK - 20, 0.5);
        const c = player("c", -0.1, MIN_CLV_BETS_TO_RANK - 10, 0);
        expect([a, b, c].sort(byClv).map((entry) => entry.id)).toEqual(["c", "b", "a"]);
    });
});

describe("pageOf", () => {
    it("counts whole pages and keeps at least one", () => {
        expect(pageOf(undefined, 0)).toEqual({ page: 1, pages: 1 });
        expect(pageOf(undefined, 50)).toEqual({ page: 1, pages: 1 });
        expect(pageOf("2", 51)).toEqual({ page: 2, pages: 2 });
    });

    it("falls back to the first page for junk and to the last for a page past the end", () => {
        expect(pageOf("abc", 120)).toEqual({ page: 1, pages: 3 });
        expect(pageOf("0", 120)).toEqual({ page: 1, pages: 3 });
        expect(pageOf("1.5", 120)).toEqual({ page: 1, pages: 3 });
        expect(pageOf("9", 120)).toEqual({ page: 3, pages: 3 });
    });
});

describe("runningClv", () => {
    it("averages CLV so far after each settled bet that has one", () => {
        const at = (day: number) => new Date(Date.UTC(2026, 10, day));
        expect(
            runningClv([
                { clv: 0.04, settledAt: at(1) },
                { clv: null, settledAt: at(2) },
                { clv: -0.02, settledAt: at(3) },
            ]),
        ).toEqual([
            { t: at(1).getTime(), value: 0.04 },
            { t: at(3).getTime(), value: 0.01 },
        ]);
    });
});
