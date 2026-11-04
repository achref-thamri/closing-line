import { describe, expect, it } from "vitest";
import { parseResults, parseSeason } from "../seasons.ts";
import { backtest } from "../simulate.ts";

const header =
    "Div,Date,HomeTeam,AwayTeam,FTHG,FTAG,B365H,B365D,B365A,BWH,BWD,BWA,PSH,PSD,PSA,WHH,WHD,WHA,PSCH,PSCD,PSCA";
// Pinnacle 2.00/3.60/4.00 has about 3% margin; fair away is about 4.2 (the power method takes more margin off long shots). Bet365's 4.60 is about 9% value.
const valueMatch = "E1,08/11/2024,Hull,Watford,1,2,1.95,3.4,4.6,1.9,3.5,3.9,2.0,3.6,4.0,1.9,3.4,3.8,2.1,3.6,3.7";
const noValue = "E1,09/11/2024,Leeds,Derby,2,0,1.5,4.0,6.0,1.5,4.0,6.0,1.55,4.3,6.5,1.5,4.0,6.0,1.5,4.4,7.0";
const missingPinnacle = "E1,10/11/2024,Luton,Stoke,0,0,2.0,3.3,3.8,2.0,3.3,3.8,,,,2.0,3.3,3.8,,,";
const csv = [header, valueMatch, noValue, missingPinnacle, ""].join("\r\n");
const options = {
    startingBankroll: 10_000,
    stake: { kellyMultiplier: 0.25, maxBankrollFraction: 0.02, minStake: 50, maxStake: 500, step: 10 },
};

describe("parseSeason", () => {
    it("reads matches with Pinnacle's early and closing prices and skips the rest", () => {
        const matches = parseSeason(`\uFEFF${csv}`);
        expect(matches).toHaveLength(2);
        expect(matches[0]).toMatchObject({
            league: "E1",
            playedAt: new Date("2024-11-08T00:00:00Z"),
            home: "Hull",
            away: "Watford",
            homeGoals: 1,
            awayGoals: 2,
            sharpEarly: { home: 2, draw: 3.6, away: 4 },
            sharpClosing: { home: 2.1, draw: 3.6, away: 3.7 },
        });
        expect(Object.keys(matches[0]?.soft ?? {})).toEqual(["B365", "BW", "WH"]);
    });

    it("finds the first column behind a byte order mark read as latin1", () => {
        const decoded = Buffer.from(`\uFEFF${csv}`, "utf8").toString("latin1");
        expect(parseSeason(decoded)[0]?.league).toBe("E1");
    });
});

describe("parseResults", () => {
    it("keeps every finished match, priced or not, and reads two-digit years", () => {
        const results = parseResults([csv, "E1,11/11/24,Leeds,Hull,3,1", "E1,12/11/2024,Derby,Luton,,"].join("\n"));
        expect(results.map((result) => `${result.home} ${result.homeGoals}-${result.awayGoals}`)).toEqual([
            "Hull 1-2",
            "Leeds 2-0",
            "Luton 0-0",
            "Leeds 3-1",
        ]);
        expect(results[3]?.playedAt).toEqual(new Date("2024-11-11T00:00:00Z"));
    });
});

describe("backtest", () => {
    it("backs the best soft price above the threshold, measures CLV and settles on the score", () => {
        const result = backtest(parseSeason(csv), { ...options, minEdge: 0.03 });
        expect(result).toMatchObject({ matches: 2, bets: 1, won: 1, maxDrawdown: 0 });
        expect(result.staked).toBeGreaterThan(0);
        expect(result.profit).toBeCloseTo(result.staked * 3.6);
        // The price shortened to 3.70 at Pinnacle's close, so 4.60 beat it.
        expect(result.averageClv).toBeGreaterThan(0.1);
        expect(result.beatClosing).toBe(1);
        expect(result.finalBankroll).toBeCloseTo(10_000 + result.profit);
    });

    it("finds nothing above a high threshold", () => {
        expect(backtest(parseSeason(csv), { ...options, minEdge: 0.2 })).toMatchObject({
            bets: 0,
            roi: undefined,
            averageClv: undefined,
            beatClosing: undefined,
            finalBankroll: 10_000,
        });
    });

    it("tracks the drawdown from the bankroll's peak", () => {
        const losing = valueMatch.replace(",1,2,", ",2,0,");
        const result = backtest(parseSeason([header, valueMatch, losing].join("\n")), { ...options, minEdge: 0.03 });
        expect(result).toMatchObject({ bets: 2, won: 1 });
        expect(result.maxDrawdown).toBeGreaterThan(0);
    });
});
