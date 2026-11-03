import { describe, expect, it } from "vitest";
import { fixtureNamed, matchFixture, normalizeTeam, sameTeam } from "../teams.ts";

// Premier League 2026/27 as named by The Odds API and by football-data.org (name, short name), 1 November 2026.
const ODDS_API = [
    "Arsenal",
    "Aston Villa",
    "Bournemouth",
    "Brentford",
    "Brighton and Hove Albion",
    "Chelsea",
    "Coventry City",
    "Crystal Palace",
    "Everton",
    "Fulham",
    "Hull City",
    "Ipswich Town",
    "Leeds United",
    "Liverpool",
    "Manchester City",
    "Manchester United",
    "Newcastle United",
    "Nottingham Forest",
    "Sunderland",
    "Tottenham Hotspur",
];
const FOOTBALL_DATA = [
    ["Arsenal FC", "Arsenal"],
    ["Aston Villa FC", "Aston Villa"],
    ["Chelsea FC", "Chelsea"],
    ["Everton FC", "Everton"],
    ["Fulham FC", "Fulham"],
    ["Liverpool FC", "Liverpool"],
    ["Manchester City FC", "Man City"],
    ["Manchester United FC", "Man United"],
    ["Newcastle United FC", "Newcastle"],
    ["Sunderland AFC", "Sunderland"],
    ["Tottenham Hotspur FC", "Tottenham"],
    ["Hull City AFC", "Hull City"],
    ["Leeds United FC", "Leeds United"],
    ["Ipswich Town FC", "Ipswich Town"],
    ["Nottingham Forest FC", "Nottingham"],
    ["Crystal Palace FC", "Crystal Palace"],
    ["Brighton & Hove Albion FC", "Brighton Hove"],
    ["Brentford FC", "Brentford"],
    ["AFC Bournemouth", "Bournemouth"],
    ["Coventry City FC", "Coventry City"],
];

describe("normalizeTeam", () => {
    it("drops filler words, accents and punctuation", () => {
        expect(normalizeTeam("Brighton & Hove Albion FC")).toEqual(["brighton", "and", "hove", "albion"]);
        expect(normalizeTeam("Atlético de Madrid")).toEqual(["atletico", "de", "madrid"]);
        expect(normalizeTeam("AFC Bournemouth")).toEqual(["bournemouth"]);
    });
});

describe("sameTeam", () => {
    it("maps every Premier League club to exactly one club in the other source", () => {
        for (const name of ODDS_API) {
            const matches = FOOTBALL_DATA.filter((aliases) => sameTeam(name, aliases));
            expect(matches, name).toHaveLength(1);
        }
    });

    it("keeps the two Manchester clubs apart", () => {
        expect(sameTeam("Manchester City", ["Manchester United FC", "Man United"])).toBe(false);
        expect(sameTeam("Manchester United", ["Manchester City FC", "Man City"])).toBe(false);
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
