import { describe, expect, it } from "vitest";
import { fixtureNamed, matchFixture, normalizeTeam, sameTeam } from "../teams.ts";

import teamNames from "./team-names.json" with { type: "json" };

// Every club in the six live leagues, 2026/27, as The Odds API names it and as football-data.org does (name, short
// name). Taken from production fixtures and the football-data.org teams endpoint on 2026-11-09.
const LEAGUES: Record<string, { oddsApi: string[]; footballData: string[][] }> = teamNames;

describe("normalizeTeam", () => {
    it("drops filler words, accents and punctuation", () => {
        expect(normalizeTeam("Brighton & Hove Albion FC")).toEqual(["brighton", "and", "hove", "albion"]);
        expect(normalizeTeam("Atlético de Madrid")).toEqual(["atletico", "de", "madrid"]);
        expect(normalizeTeam("AFC Bournemouth")).toEqual(["bournemouth"]);
    });
});

describe("sameTeam", () => {
    it.each(Object.keys(LEAGUES))("pairs every %s club one-to-one with the results feed", (league) => {
        const { oddsApi, footballData } = LEAGUES[league] ?? { oddsApi: [], footballData: [] };
        for (const name of oddsApi) {
            const matches = footballData.filter((aliases) => sameTeam(name, aliases));
            expect(matches, name).toHaveLength(1);
        }
        for (const aliases of footballData) {
            const matches = oddsApi.filter((name) => sameTeam(name, aliases));
            expect(matches, aliases[0]).toHaveLength(1);
        }
    });

    it("keeps clubs apart when one name sits inside another", () => {
        expect(sameTeam("Barcelona", ["RCD Espanyol de Barcelona", "Espanyol"])).toBe(false);
        expect(sameTeam("Inter Milan", ["AC Milan", "Milan"])).toBe(false);
        expect(sameTeam("Paris FC", ["Paris Saint-Germain FC", "PSG"])).toBe(false);
        expect(sameTeam("Paris Saint Germain", ["Paris FC", "Paris FC"])).toBe(false);
    });

    it("keeps the two Manchester clubs apart", () => {
        expect(sameTeam("Manchester City", ["Manchester United FC", "Man United"])).toBe(false);
        expect(sameTeam("Manchester United", ["Manchester City FC", "Man City"])).toBe(false);
    });

    it("knows clubs whose two names share no word", () => {
        expect(sameTeam("Rennes", ["Stade Rennais FC 1901", "Stade Rennais"])).toBe(true);
        expect(sameTeam("Rennes", ["Lille OSC", "Lille"])).toBe(false);
    });

    it("never matches an empty name", () => {
        expect(sameTeam("FC", ["Arsenal FC"])).toBe(false);
        expect(sameTeam("Arsenal", [""])).toBe(false);
    });
});

describe("matchFixture", () => {
    const kickoff = new Date("2026-10-31T15:00:00Z");
    const candidates = [
        {
            id: 1,
            kickoff,
            home: ["Manchester City FC", "Man City"],
            away: ["Brighton & Hove Albion FC", "Brighton Hove"],
        },
        { id: 2, kickoff, home: ["Brentford FC", "Brentford"], away: ["Nottingham Forest FC", "Nottingham"] },
    ];
    const HOURS_3 = 3 * 3_600_000;

    it("finds the result with both teams and a close kickoff", () => {
        const fixture = { homeTeam: "Brentford", awayTeam: "Nottingham Forest", kickoff };
        expect(matchFixture(fixture, candidates, HOURS_3)?.id).toBe(2);
    });

    it("does not swap home and away", () => {
        const fixture = { homeTeam: "Nottingham Forest", awayTeam: "Brentford", kickoff };
        expect(matchFixture(fixture, candidates, HOURS_3)).toBeUndefined();
    });

    it("ignores the same pairing on another day", () => {
        const fixture = {
            homeTeam: "Brentford",
            awayTeam: "Nottingham Forest",
            kickoff: new Date("2027-03-01T15:00:00Z"),
        };
        expect(matchFixture(fixture, candidates, HOURS_3)).toBeUndefined();
    });

    it("refuses to guess between two candidates", () => {
        const fixture = { homeTeam: "Brentford", awayTeam: "Nottingham Forest", kickoff };
        expect(
            matchFixture(
                fixture,
                [...candidates, { id: 3, kickoff, home: ["Brentford"], away: ["Nottingham Forest"] }],
                HOURS_3,
            ),
        ).toBeUndefined();
    });
});

describe("fixtureNamed", () => {
    const fixtures = [
        { id: "f1", homeTeam: "Bayern Munich", awayTeam: "Borussia Dortmund" },
        { id: "f2", homeTeam: "Arsenal", awayTeam: "Chelsea" },
        { id: "f3", homeTeam: "Chelsea", awayTeam: "Arsenal" },
        { id: "f4", homeTeam: "Manchester City", awayTeam: "Everton" },
        { id: "f5", homeTeam: "Manchester United", awayTeam: "Everton" },
    ];

    it("finds the one fixture a typed match names, home side first", () => {
        expect(fixtureNamed("Bayern – Dortmund", fixtures)?.id).toBe("f1");
        expect(fixtureNamed("arsenal v chelsea", fixtures)?.id).toBe("f2");
        expect(fixtureNamed("Chelsea-Arsenal", fixtures)?.id).toBe("f3");
    });

    it("finds nothing when no fixture or several fit, or the text names no two teams", () => {
        expect(fixtureNamed("Dortmund – Bayern", fixtures)).toBeUndefined();
        expect(fixtureNamed("Manchester – Everton", fixtures)).toBeUndefined();
        expect(fixtureNamed("Bayern", fixtures)).toBeUndefined();
    });
});
