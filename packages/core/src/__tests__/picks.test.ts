import { describe, expect, it } from "vitest";
import { bookName, pickText, sideName } from "../picks.ts";

describe("pickText", () => {
    const base = { playerName: null, line: null, eventName: "Newcastle United - Everton" };

    it("names the team for match results, from the event or the fixture", () => {
        expect(pickText({ ...base, market: "match_result", selection: "home" })).toBe("Newcastle United to win");
        expect(pickText({ ...base, market: "match_result", selection: "draw" })).toBe("Draw");
        expect(pickText({ ...base, market: "h2h", selection: "away", teams: ["Leeds", "Spurs"] })).toBe("Spurs to win");
        expect(pickText({ ...base, eventName: "?", market: "match_result", selection: "home" })).toBe("home");
    });

    it("describes lines, winners and other picks", () => {
        expect(
            pickText({ ...base, market: "player_shots_on_target", selection: "over", playerName: "Davies", line: 0.5 }),
        ).toBe("Davies shots on target over 0.5");
        expect(pickText({ ...base, market: "corners", selection: "under", line: 9.5 })).toBe("corners under 9.5");
        expect(pickText({ ...base, market: "match_winner", selection: "Team Liquid" })).toBe("Team Liquid to win");
        expect(pickText({ ...base, market: "other", selection: "Both teams to score" })).toBe("Both teams to score");
    });
});

describe("bookName", () => {
    it("names known bookmakers and title-cases the rest", () => {
        expect(bookName("unibet_se")).toBe("Unibet");
        expect(bookName("danske_spil")).toBe("Danske Spil");
        expect(bookName("expekt")).toBe("Expekt");
    });
});

describe("sideName", () => {
    it("names the team a match-result selection backs", () => {
        const match = { homeTeam: "Bayern Munich", awayTeam: "Arsenal" };
        expect([sideName(match, "home"), sideName(match, "draw"), sideName(match, "away")]).toEqual([
            "Bayern Munich",
            "Draw",
            "Arsenal",
        ]);
    });
});
