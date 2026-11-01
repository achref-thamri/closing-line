import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { HttpError, PermanentError, TransientError } from "../../../lib/errors.ts";
import type { Fetch } from "../../../lib/http.ts";
import { OutOfCreditsError } from "../../../ports/odds.ts";
import { OddsApiClient } from "../client.ts";

const recording = (name: string) => readFileSync(new URL(`recordings/${name}`, import.meta.url), "utf8");
const now = new Date("2026-11-01T09:00:00Z");
const credits = { "x-requests-used": "1", "x-requests-remaining": "499", "x-requests-last": "1" };

function fakeFetch(...responses: Response[]) {
    const fn = vi.fn<Fetch>();
    for (const response of responses) fn.mockResolvedValueOnce(response);
    return fn;
}

function json(body: string, status = 200, headers: Record<string, string> = credits) {
    return new Response(body, { status, headers: { "content-type": "application/json", ...headers } });
}

function client(fetch: Fetch) {
    return new OddsApiClient({
        apiKey: "secret-key",
        now: () => now,
        fetch,
        retry: { sleep: () => Promise.resolve() },
    });
}

describe("OddsApiClient.odds", () => {
    it("maps a recorded response to quotes per selection", async () => {
        const fetch = fakeFetch(json(recording("odds-h2h.json")));
        const { data, balance } = await client(fetch).odds("soccer_epl", ["pinnacle", "unibet_se"]);

        expect(balance).toEqual({ used: 1, remaining: 499, lastCost: 1, takenAt: now });
        expect(data).toHaveLength(2);
        const [match] = data;
        expect(match).toMatchObject({
            id: "6a3819cdbe2ba2fe5a3d8f9b4b459965",
            league: "soccer_epl",
            homeTeam: "Liverpool",
            awayTeam: "Arsenal",
            kickoff: new Date("2026-11-01T16:30:00Z"),
        });
        const pinnacle = match?.quotes.filter((quote) => quote.bookmaker === "pinnacle");
        expect(pinnacle?.map((quote) => quote.selection).sort()).toEqual(["away", "draw", "home"]);
        expect(pinnacle?.every((quote) => quote.price > 1)).toBe(true);
    });

    it("asks for decimal match-result odds from the named bookmakers", async () => {
        const fetch = fakeFetch(json("[]"));
        await client(fetch).odds("soccer_epl", ["pinnacle", "unibet_se"]);

        const url = fetch.mock.calls[0]?.[0] as URL;
        expect(url.pathname).toBe("/v4/sports/soccer_epl/odds");
        expect(Object.fromEntries(url.searchParams)).toEqual({
            markets: "h2h",
            oddsFormat: "decimal",
            bookmakers: "pinnacle,unibet_se",
            dateFormat: "iso",
            apiKey: "secret-key",
        });
    });

    it("drops outcomes it cannot place and markets other than h2h", async () => {
        const event = {
            id: "a".repeat(32),
            sport_key: "soccer_epl",
            commence_time: "2026-11-08T15:00:00Z",
            home_team: "Fulham",
            away_team: "Everton",
            bookmakers: [
                {
                    key: "pinnacle",
                    last_update: "2026-11-01T08:00:00Z",
                    markets: [
                        {
                            key: "h2h",
                            outcomes: [
                                { name: "Fulham", price: 2.2 },
                                { name: "Over 2.5", price: 1.9 },
                            ],
                        },
                        { key: "h2h_lay", outcomes: [{ name: "Fulham", price: 2.3 }] },
                    ],
                },
            ],
        };
        const { data } = await client(fakeFetch(json(JSON.stringify([event])))).odds("soccer_epl", ["pinnacle"]);
        expect(data[0]?.quotes).toEqual([
            {
                bookmaker: "pinnacle",
                market: "h2h",
                selection: "home",
                price: 2.2,
                updatedAt: new Date("2026-11-01T08:00:00Z"),
            },
        ]);
    });

    it("refuses more than ten bookmakers, which would cost double", async () => {
        const books = Array.from({ length: 11 }, (_, i) => `book${i}`);
        await expect(client(fakeFetch()).odds("soccer_epl", books)).rejects.toThrow(RangeError);
        await expect(client(fakeFetch()).odds("soccer_epl", [])).rejects.toThrow(RangeError);
    });
});

describe("OddsApiClient.events and balance", () => {
    it("lists fixtures for free", async () => {
        const free = { "x-requests-used": "1", "x-requests-remaining": "499", "x-requests-last": "0" };
        const { data, balance } = await client(fakeFetch(json(recording("events.json"), 200, free))).events(
            "soccer_epl",
        );
        expect(data).toHaveLength(3);
        expect(data[0]).toEqual({
            id: "6a3819cdbe2ba2fe5a3d8f9b4b459965",
            league: "soccer_epl",
            homeTeam: "Liverpool",
            awayTeam: "Arsenal",
            kickoff: new Date("2026-11-01T16:30:00Z"),
        });
        expect(balance.lastCost).toBe(0);
    });

    it("reads the balance from a free call", async () => {
        const fetch = fakeFetch(json("[]"));
        expect(await client(fetch).balance()).toEqual({ used: 1, remaining: 499, lastCost: 1, takenAt: now });
        expect((fetch.mock.calls[0]?.[0] as URL).pathname).toBe("/v4/sports");
    });

    it("reads missing credit headers as zero, which stops paid calls", async () => {
        expect(await client(fakeFetch(json("[]", 200, {}))).balance()).toMatchObject({ used: 0, remaining: 0 });
    });
});

describe("OddsApiClient errors", () => {
    it("turns used-up credits into OutOfCreditsError", async () => {
        const body = JSON.stringify({ message: "Usage quota has been reached", error_code: "OUT_OF_USAGE_CREDITS" });
        await expect(client(fakeFetch(json(body, 401, {}))).odds("soccer_epl", ["pinnacle"])).rejects.toThrow(
            OutOfCreditsError,
        );
    });

    it("reports a bad key without leaking it", async () => {
        const body = JSON.stringify({ message: "API key is not valid.", error_code: "INVALID_KEY" });
        const error = await client(fakeFetch(json(body, 401, {})))
            .events("soccer_epl")
            .catch((caught: unknown) => caught);
        expect(error).toBeInstanceOf(HttpError);
        expect((error as Error).message).toBe("Odds API events: 401 API key is not valid.");
        expect((error as Error).message).not.toContain("secret-key");
    });

    it("retries server errors and rate limits, then succeeds", async () => {
        const fetch = fakeFetch(json("oops", 502, {}), json("slow down", 429, { "retry-after": "2" }), json("[]"));
        expect((await client(fetch).events("soccer_epl")).data).toEqual([]);
        expect(fetch).toHaveBeenCalledTimes(3);
    });

    it("gives up after three attempts", async () => {
        const fetch = vi.fn<Fetch>().mockRejectedValue(new Error("socket hang up"));
        await expect(client(fetch).events("soccer_epl")).rejects.toThrow(TransientError);
        expect(fetch).toHaveBeenCalledTimes(3);
    });

    it("rejects a response that is not what the API documents", async () => {
        await expect(client(fakeFetch(json('[{"id": 1}]'))).events("soccer_epl")).rejects.toThrow(PermanentError);
        await expect(client(fakeFetch(json("<html>"))).events("soccer_epl")).rejects.toThrow("response is not JSON");
    });
});
