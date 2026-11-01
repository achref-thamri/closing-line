import { parseConfig } from "@betting/config";
import { createRepositories, openDatabase, type DatabaseHandle, type Repositories } from "@betting/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { MatchResultInfo } from "../../ports/results.ts";
import { ensurePlayers, FAVOURITE, SCANNER } from "../players.ts";
import { settleBets, type SettleBetsDeps } from "../settleBets.ts";

const config = parseConfig({
    ODDS_API_KEY: "k",
    FOOTBALL_DATA_TOKEN: "t",
    TELEGRAM_BOT_TOKEN: "1:a",
    TELEGRAM_OWNER_CHAT_ID: "1",
});
const kickoff = new Date("2026-10-31T15:00:00Z");
const id = (letter: string) => letter.repeat(32);

let handle: DatabaseHandle;
let repos: Repositories;
let now: Date;
let messages: string[];

beforeAll(async () => {
    handle = await openDatabase({ kind: "pglite" });
    repos = createRepositories(handle.db);
});

afterAll(async () => {
    await handle.close();
});

beforeEach(async () => {
    await handle.db.execute(
        "truncate players, fixtures, odds_snapshots, bets, passes, api_usage, job_runs, worker_state restart identity cascade",
    );
    await ensurePlayers(repos, config);
    await repos.fixtures.upsert([
        { id: id("a"), league: "soccer_epl", homeTeam: "Brentford", awayTeam: "Nottingham Forest", kickoff },
        {
            id: id("b"),
            league: "soccer_epl",
            homeTeam: "Manchester City",
            awayTeam: "Brighton and Hove Albion",
            kickoff,
        },
    ]);
    now = new Date("2026-10-31T21:00:00Z");
    messages = [];
});

const finished = (home: string[], away: string[], homeGoals: number, awayGoals: number): MatchResultInfo => ({
    kickoff,
    home,
    away,
    status: "finished",
    homeGoals,
    awayGoals,
});

function deps(results: MatchResultInfo[]): SettleBetsDeps & { fetchResults: ReturnType<typeof vi.fn> } {
    const fetchResults = vi.fn(() => Promise.resolve(results));
    return {
        fetchResults,
        results: { results: fetchResults },
        repos,
        config,
        now: () => now,
        notify: (message) => {
            messages.push(message);
            return Promise.resolve();
        },
    };
}

async function bet(playerId: string, fixtureId: string, selection: string, lockedOdds: number, stakeOre = 10_000) {
    await repos.bets.place({
        playerId,
        fixtureId,
        market: "h2h",
        selection,
        stakeOre,
        lockedOdds,
        bookmaker: "unibet_se",
    });
}

describe("settleBets", () => {
    it("settles bets by the real score and reports them", async () => {
        await bet(SCANNER, id("a"), "home", 2.1, 15_000);
        await bet(FAVOURITE, id("b"), "home", 1.4);
        const results = [
            finished(["Brentford FC", "Brentford"], ["Nottingham Forest FC", "Nottingham"], 2, 0),
            finished(["Manchester City FC", "Man City"], ["Brighton & Hove Albion FC", "Brighton Hove"], 0, 1),
        ];

        expect(await settleBets(deps(results))).toEqual({ fixtures: 2, settledBets: 2, unmatched: [] });
        expect(await repos.bets.forPlayer(SCANNER)).toMatchObject([
            { status: "won", profitOre: 16_500, settledAt: now },
        ]);
        expect(await repos.bets.forPlayer(FAVOURITE)).toMatchObject([{ status: "lost", profitOre: -10_000 }]);
        expect(await repos.fixtures.get(id("a"))).toMatchObject({ status: "finished", homeGoals: 2, awayGoals: 0 });
        expect(messages).toEqual([
            "📒 Settled 2 paper bet(s):\n" +
                "Value scanner: won +165 kr — Brentford v Nottingham Forest\n" +
                "Always the favourite: lost -100 kr — Manchester City v Brighton and Hove Albion",
        ]);
    });

    it("asks for results around the kickoffs, once per league", async () => {
        const run = deps([]);
        await settleBets(run);
        expect(run.fetchResults).toHaveBeenCalledOnce();
        expect(run.fetchResults).toHaveBeenCalledWith(
            "PL",
            new Date("2026-10-30T15:00:00Z"),
            new Date("2026-11-01T15:00:00Z"),
        );
    });

    it("waits for matches that are not over or not reported yet", async () => {
        await bet(SCANNER, id("a"), "home", 2.1);
        const pending = { ...finished(["Brentford FC"], ["Nottingham Forest FC"], 0, 0), status: "pending" as const };
        expect(await settleBets(deps([pending]))).toEqual({
            fixtures: 0,
            settledBets: 0,
            unmatched: ["Manchester City v Brighton and Hove Albion"],
        });
        expect(await repos.bets.open()).toHaveLength(1);
        expect(messages).toEqual([]);

        now = new Date(kickoff.getTime() + 60 * 60_000);
        expect(await settleBets(deps([]))).toEqual({ fixtures: 0, settledBets: 0, unmatched: [] });
    });

    it("voids bets on matches called off or missing for 48 hours", async () => {
        await bet(SCANNER, id("a"), "away", 3.2);
        await bet(SCANNER, id("b"), "home", 1.5);
        const postponed = {
            ...finished(["Brentford FC"], ["Nottingham Forest FC"], 0, 0),
            status: "called_off" as const,
        };

        expect((await settleBets(deps([postponed]))).settledBets).toBe(0);
        now = new Date(kickoff.getTime() + 49 * 3_600_000);
        expect(await settleBets(deps([postponed]))).toEqual({ fixtures: 2, settledBets: 2, unmatched: [] });
        expect((await repos.bets.forPlayer(SCANNER)).map((row) => [row.status, row.profitOre])).toEqual([
            ["void", 0],
            ["void", 0],
        ]);
        expect(await repos.fixtures.get(id("a"))).toMatchObject({ status: "void" });
    });

    it("leaves leagues without a results source alone", async () => {
        const noResults = { ...config, leagues: [{ oddsApiKey: "soccer_epl", name: "Premier League" }] };
        const run = { ...deps([]), config: noResults };
        expect(await settleBets(run)).toEqual({ fixtures: 0, settledBets: 0, unmatched: [] });
        expect(run.fetchResults).not.toHaveBeenCalled();
    });

    it("settles a fixture only once", async () => {
        await bet(SCANNER, id("a"), "home", 2.1);
        const results = [finished(["Brentford FC"], ["Nottingham Forest FC"], 2, 0)];
        await settleBets(deps(results));
        now = new Date(now.getTime() + 2 * 3_600_000);
        expect((await settleBets(deps(results))).fixtures).toBe(0);
        expect(messages).toHaveLength(1);
    });
});
