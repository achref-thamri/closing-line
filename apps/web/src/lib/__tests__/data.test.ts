import { describe, expect, it } from "vitest";
import { byGrowth, pageOf } from "../data.ts";

describe("byGrowth", () => {
    it("ranks by growth, not kroner: 1,000 kr on 10,000 beats 3,000 kr on 60,000", () => {
        const scanner = { id: "scanner", growth: 100_000 / 1_000_000 };
        const bettor = { id: "friend", growth: 300_000 / 6_000_000 };
        const favourite = { id: "favourite", growth: -0.02 };
        expect([bettor, favourite, scanner].sort(byGrowth).map((player) => player.id)).toEqual([
            "scanner",
            "friend",
            "favourite",
        ]);
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
