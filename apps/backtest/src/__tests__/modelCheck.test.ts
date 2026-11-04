import { describe, expect, it } from "vitest";
import { checkModel } from "../modelCheck.ts";
import type { PastMatch, SeasonResult } from "../seasons.ts";

const options = { halfLifeDays: 365, prior: 1, blendWeights: [0, 1], minEdge: 0.02 };
const even = { home: 2.6, draw: 3.3, away: 2.8 };

/** Twenty past matches in which Leeds beat Hull 3-0 at home and 2-0 away, all before Monday 4 Nov 2024. */
const history: SeasonResult[] = Array.from({ length: 20 }, (_, i) => {
    const leedsHome = i % 2 === 0;
    return {
        league: "E1",
        home: leedsHome ? "Leeds" : "Hull",
        away: leedsHome ? "Hull" : "Leeds",
        homeGoals: leedsHome ? 3 : 0,
        awayGoals: leedsHome ? 0 : 2,
        playedAt: new Date(Date.UTC(2024, 8, 1 + i * 3)),
    };
});

function match(overrides: Partial<PastMatch>): PastMatch {
    return {
        league: "E1",
        home: "Leeds",
        away: "Hull",
        homeGoals: 1,
        awayGoals: 0,
        playedAt: new Date("2024-11-08T00:00:00Z"),
        sharpEarly: even,
        sharpClosing: even,
        soft: { B365: { home: 2.5, draw: 3.2, away: 2.7 } },
        ...overrides,
    };
}

describe("checkModel", () => {
    it("scores the model, Pinnacle and each blend on the same matches", () => {
        const result = checkModel(history, [match({})], options);
        expect(result.logLoss.matches).toBe(1);
        // The model has seen Leeds win every game, so it gives the home win far more than Pinnacle's even price.
        expect(result.logLoss.model).toBeLessThan(result.logLoss.sharpEarly);
        expect(result.blends[0]?.logLoss).toBeCloseTo(result.logLoss.sharpEarly, 12);
        expect(result.blends[1]?.logLoss).toBeCloseTo(result.logLoss.model, 12);
        expect(result.byTier.second.matches).toBe(1);
        expect(result.byTier.top.matches).toBe(0);
    });

    it("counts E0 and SP1 as first divisions and SP2 below them", () => {
        const spanish = history.map((result) => ({ ...result, league: "SP2" }));
        const { byTier } = checkModel(
            [...history, ...spanish],
            [match({ league: "E0" }), match({ league: "SP1" }), match({ league: "SP2" })],
            options,
        );
        expect(byTier.top.matches).toBe(2);
        expect(byTier.second.matches).toBe(1);
    });

    it("bets where the blend sees value, and scores the bet on Pinnacle's close and the result", () => {
        const [scanner, model] = checkModel(history, [match({})], options).blends;
        expect(scanner).toMatchObject({ bets: 0, averageClv: undefined, flatRoi: undefined });
        // Bet365's 2.50 on Leeds is far above the model's fair price, and Leeds won.
        expect(model?.bets).toBe(1);
        expect(model?.flatRoi).toBeCloseTo(1.5);
        expect(model?.averageClv).toBeLessThan(0);
        expect(model?.beatClosing).toBe(0);
    });

    it("fits only on results played before the week of the match", () => {
        const later: SeasonResult = {
            league: "E1",
            home: "Leeds",
            away: "Hull",
            homeGoals: 0,
            awayGoals: 6,
            playedAt: new Date("2024-11-05"),
        };
        const without = checkModel(history, [match({})], options);
        expect(checkModel([...history, later], [match({})], options)).toEqual(without);
    });

    it("skips matches with a team or a country it has no results for", () => {
        const result = checkModel(
            history,
            [match({ away: "Luton" }), match({ league: "SP1", home: "Betis", away: "Getafe" })],
            options,
        );
        expect(result.logLoss.matches).toBe(0);
        expect(result.blends[0]?.bets).toBe(0);
    });
});
