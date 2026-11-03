import type { BetWithFixture } from "@closing-line/db";
import { describe, expect, it } from "vitest";
import { reason } from "../BetsTable.tsx";

const bet = (overrides: Partial<BetWithFixture>) =>
    ({ selfReported: false, tag: null, edgeAtBet: null, ...overrides }) as BetWithFixture;

describe("reason", () => {
    it("shows the scanner's edge over Pinnacle's fair price", () => {
        expect(reason(bet({ edgeAtBet: 0.0421 }), { kind: "scanner" })).toBe("📊 +4.2% vs Pinnacle");
        expect(reason(bet({}), { kind: "scanner" })).toBe("");
    });

    it("explains the favourite's rule", () => {
        expect(reason(bet({}), { kind: "benchmark" })).toBe("⭐ Pinnacle favourite");
    });

    it("keeps a bettor's own tag, and nothing when there is none", () => {
        expect(reason(bet({ selfReported: true, tag: "lineup" }), { kind: "bettor" })).toBe("⚡ Lineup");
        expect(reason(bet({ selfReported: true }), { kind: "bettor" })).toBe("");
    });
});
