import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { Fetch } from "../../../lib/http.ts";
import { FootballDataClient } from "../client.ts";

const recording = readFileSync(new URL("recordings/pl-matches.json", import.meta.url), "utf8");

function client(body: string) {
    const fetch = vi
        .fn<Fetch>()
        .mockResolvedValue(new Response(body, { headers: { "content-type": "application/json" } }));
    return {
        fetch,
        client: new FootballDataClient({ token: "secret-token", fetch, retry: { sleep: () => Promise.resolve() } }),
    };
}

describe("FootballDataClient", () => {
    it("reads results from a recorded Premier League response", async () => {
        const { client: source } = client(recording);
        const results = await source.results("PL", new Date("2026-10-31T00:00:00Z"), new Date("2026-11-03T00:00:00Z"));
        expect(results).toHaveLength(10);
        expect(results[0]).toEqual({
            kickoff: new Date("2026-10-31T12:30:00Z"),
            home: ["Chelsea FC", "Chelsea"],
            away: ["Manchester United FC", "Man United"],
            status: "finished",
            homeGoals: 2,
            awayGoals: 0,
        });
        expect(results.find((result) => result.home.includes("Liverpool FC"))).toMatchObject({
            status: "pending",
            homeGoals: null,
        });
    });

    it("asks for the date range with the token in a header", async () => {
        const { fetch, client: source } = client('{"matches": []}');
        await source.results("PL", new Date("2026-10-31T15:00:00Z"), new Date("2026-11-03T15:00:00Z"));
        const [url, init] = fetch.mock.calls[0] ?? [];
        expect((url as URL).href).toBe(
            "https://api.football-data.org/v4/competitions/PL/matches?dateFrom=2026-10-31&dateTo=2026-11-03",
        );
        expect((init?.headers as Record<string, string>)["X-Auth-Token"]).toBe("secret-token");
    });

    it("settles on regular time when a match went to extra time, and reads called-off matches", async () => {
        const team = (name: string) => ({ name, shortName: null });
        const body = JSON.stringify({
            matches: [
                {
                    utcDate: "2026-11-04T20:00:00Z",
                    status: "FINISHED",
                    homeTeam: team("Arsenal FC"),
                    awayTeam: team("Chelsea FC"),
                    score: { fullTime: { home: 2, away: 1 }, regularTime: { home: 1, away: 1 } },
                },
                {
                    utcDate: "2026-11-05T20:00:00Z",
                    status: "POSTPONED",
                    homeTeam: team("Everton FC"),
                    awayTeam: { name: "Fulham FC", shortName: "" },
                    score: { fullTime: { home: null, away: null } },
                },
            ],
        });
        const [extraTime, postponed] = await client(body).client.results("CL", new Date(), new Date());
        expect(extraTime).toMatchObject({ status: "finished", homeGoals: 1, awayGoals: 1, home: ["Arsenal FC"] });
        expect(postponed).toMatchObject({ status: "called_off", away: ["Fulham FC"] });
    });
});
