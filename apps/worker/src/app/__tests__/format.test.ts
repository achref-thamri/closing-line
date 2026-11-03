import { describe, expect, it } from "vitest";
import { describeBet, kroner, parseDecimal, parseKroner, signedKroner } from "../format.ts";

describe("describeBet", () => {
    it("shows the book and match, the pick, then odds and stake", () => {
        const card = {
            bookmaker: "betano",
            eventName: "Atalanta – Lazio",
            market: "player_shots_on_target",
            selection: "over",
            playerName: "De Ketelaere",
            line: 1.5,
            lockedOdds: 4.05,
            stakeOre: 122_500,
        };
        expect(describeBet(card)).toBe(
            "🧾 Betano · Atalanta – Lazio\nDe Ketelaere shots on target over 1.5\nOdds 4.05 · Stake 1,225 kr",
        );
        expect(describeBet({ ...card, eventName: null }).split("\n")[0]).toBe("🧾 Betano ·");
    });
});

describe("kroner", () => {
    it("formats øre as kroner, with a sign when asked", () => {
        expect(kroner(255_717)).toBe("2,557.17 kr");
        expect(signedKroner(89_717)).toBe("+897.17 kr");
        expect(signedKroner(-150_000)).toBe("−1,500 kr");
    });
});

describe("parseDecimal", () => {
    it("reads decimals with a point or a comma", () => {
        expect(parseDecimal("3,70")).toBe(3.7);
        expect(parseDecimal("3.7x")).toBeUndefined();
    });
});

describe("parseKroner", () => {
    it("reads Danish and English amounts", () => {
        expect(parseKroner("2557")).toBe(2557);
        expect(parseKroner("2.557,17 kr.")).toBe(2557.17);
        expect(parseKroner("2,557.17")).toBe(2557.17);
        expect(parseKroner("2.557")).toBe(2557);
        expect(parseKroner("12,5")).toBe(12.5);
        expect(parseKroner("1 500 DKK")).toBe(1500);
    });

    it("refuses anything that is not one amount", () => {
        expect(parseKroner("won")).toBeUndefined();
        expect(parseKroner("0")).toBeUndefined();
        expect(parseKroner("2557 and 100")).toBeUndefined();
    });
});
