import { describe, expect, it } from "vitest";
import { availableBankrollOre, settledLossOre, type LedgerBet } from "../bankroll.ts";

const at = (day: number) => new Date(Date.UTC(2026, 10, day, 18));
const bets: LedgerBet[] = [
    { stakeOre: 10_000, status: "won", profitOre: 15_000, settledAt: at(2) },
    { stakeOre: 20_000, status: "lost", profitOre: -20_000, settledAt: at(8) },
    { stakeOre: 5_000, status: "void", profitOre: 0, settledAt: at(8) },
    { stakeOre: 30_000, status: "lost", profitOre: -30_000, settledAt: at(9) },
    { stakeOre: 12_000, status: "open", profitOre: null, settledAt: null },
];

describe("availableBankrollOre", () => {
    it("adds settled profit and holds back open stakes", () => {
        expect(availableBankrollOre(1_000_000, bets)).toBe(1_000_000 + 15_000 - 20_000 - 30_000 - 12_000);
        expect(availableBankrollOre(1_000_000, [])).toBe(1_000_000);
    });
});

describe("settledLossOre", () => {
    it("sums the net loss of bets settled since a moment", () => {
        expect(settledLossOre(bets, at(7))).toBe(50_000);
        expect(settledLossOre(bets, at(1))).toBe(35_000);
    });

    it("is zero for a winning period", () => {
        expect(settledLossOre(bets.slice(0, 1), at(1))).toBe(0);
    });
});
