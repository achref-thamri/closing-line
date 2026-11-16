import type { BetWithFixture } from "@closing-line/db";
import { describe, expect, it } from "vitest";
import { placedUnderOldRules, reason } from "../BetsTable.tsx";

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

describe("placedUnderOldRules", () => {
    const kickoff = new Date("2026-11-21T15:00:00Z");
    const fixture = { homeTeam: "Nice", awayTeam: "Paris Saint Germain", kickoff, league: "soccer_france_ligue_one" };
    const scannerBet = (createdAt: Date, lockedOdds: number, sharpFairOddsAtBet: number) =>
        bet({ selection: "home", createdAt, lockedOdds, sharpFairOddsAtBet, fixture });

    it("marks scanner bets today's rules wouldn't place, like an outsider 17 days out", () => {
        expect(placedUnderOldRules(scannerBet(new Date("2026-11-04T16:18:00Z"), 7.5, 6.44), { kind: "scanner" })).toBe(
            true,
        );
        expect(placedUnderOldRules(scannerBet(new Date("2026-11-21T05:00:00Z"), 2.17, 2.07), { kind: "scanner" })).toBe(
            false,
        );
    });

    it("leaves other players' bets alone", () => {
        expect(placedUnderOldRules(scannerBet(new Date("2026-11-04T16:18:00Z"), 7.5, 6.44), { kind: "bettor" })).toBe(
            false,
        );
    });
});
