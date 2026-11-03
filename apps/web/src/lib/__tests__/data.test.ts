import { describe, expect, it } from "vitest";
import { byGrowth } from "../data.ts";

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
