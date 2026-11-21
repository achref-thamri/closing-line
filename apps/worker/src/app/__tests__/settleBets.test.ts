import { parseConfig } from "@closing-line/config";
import { createRepositories, openDatabase, type DatabaseHandle, type Repositories } from "@closing-line/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
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
        "truncate players, fixtures, odds_snapshots, bets, api_usage, job_runs, worker_state, chat_sessions restart identity cascade",
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

function deps(
    results: MatchResultInfo[],
    scores: MatchResultInfo[] | "refused" = [],
): SettleBetsDeps & { fetchResults: Mock; fetchScores: Mock } {
    const fetchResults = vi.fn(() => Promise.resolve(results));
    const fetchScores = vi.fn(() => Promise.resolve(scores === "refused" ? undefined : scores));
    return {
        fetchResults,
        fetchScores,
        results: { results: fetchResults },
        scores: fetchScores,
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

describe("settleBets for a league without football-data.org results", () => {
    const serieB = { id: id("c"), league: "soccer_italy_serie_b", homeTeam: "Palermo", awayTeam: "Bari", kickoff };
    const score = (homeGoals: number, awayGoals: number): MatchResultInfo => ({
        ...finished(["Palermo"], ["Bari"], homeGoals, awayGoals),
    });

    beforeEach(async () => {
        await repos.fixtures.upsert([serieB]);
    });

    it("settles from The Odds API's scores in the 22:00 UTC run", async () => {
        now = new Date("2026-10-31T22:15:00Z");
        await bet(SCANNER, id("c"), "away", 3.2);
        const run = deps([], [score(0, 1)]);

        expect(await settleBets(run)).toMatchObject({ settledBets: 1 });
        expect(run.fetchScores).toHaveBeenCalledExactlyOnceWith("soccer_italy_serie_b");
        expect(await repos.bets.forPlayer(SCANNER)).toMatchObject([{ status: "won", profitOre: 22_000 }]);
    });

    it("asks for scores only once a day, in the 22:00 UTC run", async () => {
        const run = deps([]);
        await settleBets(run);
        expect(run.fetchScores).not.toHaveBeenCalled();
        expect(await repos.fixtures.get(id("c"))).toMatchObject({ status: "scheduled" });
    });

    it("keeps an overdue match open when the credit guard refuses the call", async () => {
        now = new Date("2026-11-03T22:15:00Z");
        await bet(SCANNER, id("c"), "away", 3.2);

        await settleBets(deps([], "refused"));

        expect(await repos.fixtures.get(id("c"))).toMatchObject({ status: "scheduled" });
        expect(await repos.bets.forPlayer(SCANNER)).toMatchObject([{ status: "open" }]);
    });
});

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
                "Value scanner: won +165 kr on Brentford v Nottingham Forest\n" +
                "Always the favourite: lost -100 kr on Manchester City v Brighton and Hove Albion",
        ]);
    });

    it("leaves a bettor's player prop on the fixture for /open", async () => {
        await bet(SCANNER, id("a"), "home", 2.1);
        await repos.bets.place({
            playerId: SCANNER,
            fixtureId: id("a"),
            market: "player_shots_on_target",
            selection: "over",
            playerName: "Thiago",
            line: 0.5,
            stakeOre: 10_000,
            lockedOdds: 1.6,
            bookmaker: "bet25",
            selfReported: true,
        });
        const results = [finished(["Brentford FC"], ["Nottingham Forest FC"], 2, 0)];
        expect(await settleBets(deps(results))).toMatchObject({ settledBets: 1 });
        expect((await repos.bets.forPlayer(SCANNER)).map((each) => [each.market, each.status])).toEqual([
            ["h2h", "won"],
            ["player_shots_on_target", "open"],
        ]);
    });

    it("settles the other leagues and still reports them when one league's results fail", async () => {
        await repos.fixtures.upsert([
            {
                id: id("c"),
                league: "soccer_germany_bundesliga",
                homeTeam: "Bayern Munich",
                awayTeam: "Union Berlin",
                kickoff,
            },
        ]);
        await bet(SCANNER, id("a"), "home", 2.1);
        await bet(SCANNER, id("c"), "home", 1.5);
        const run = deps([]);
        run.results = {
            results: (code: string) =>
                code === "PL"
                    ? Promise.reject(new Error("football-data.org: server error 503"))
                    : Promise.resolve([finished(["Bayern Munich"], ["Union Berlin"], 3, 0)]),
        };

        await expect(settleBets(run)).rejects.toThrow("Premier League: football-data.org: server error 503");
        expect((await repos.bets.forPlayer(SCANNER)).map((each) => [each.fixtureId, each.status])).toEqual([
            [id("a"), "open"],
            [id("c"), "won"],
        ]);
        expect(messages).toEqual([
            "📒 Settled 1 paper bet(s):\nValue scanner: won +50 kr on Bayern Munich v Union Berlin",
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

    it("waits for matches that are not over or not reported yet, and flags one missing from the feed", async () => {
        await bet(SCANNER, id("a"), "home", 2.1);
        const pending = { ...finished(["Brentford FC"], ["Nottingham Forest FC"], 0, 0), status: "pending" as const };
        expect(await settleBets(deps([pending]))).toEqual({
            fixtures: 0,
            settledBets: 0,
            unmatched: ["Manchester City v Brighton and Hove Albion"],
        });
        expect(await repos.bets.open()).toHaveLength(1);
        // Six hours after kickoff a match missing from the feed is a name mismatch: said once, not every hour.
        expect(messages).toEqual([
            "⚠️ No result found for Manchester City v Brighton and Hove Albion (Premier League). The results feed " +
                "probably names a team differently. Pin the name in PINNED_NAMES (packages/core/src/teams.ts) within " +
                "48 hours of kickoff, or its bets are voided.",
        ]);
        now = new Date(now.getTime() + 3_600_000);
        await settleBets(deps([pending]));
        expect(messages).toHaveLength(1);

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
        expect(messages.filter((message) => message.startsWith("📒"))).toHaveLength(1);
    });
});

describe("settleBets alerts", () => {
    it("doesn't flag a missing match before six hours after kickoff", async () => {
        now = new Date(kickoff.getTime() + 5 * 3_600_000);
        await settleBets(deps([finished(["Brentford FC"], ["Nottingham Forest FC"], 1, 1)]));
        expect(messages).toEqual([]);
    });
});
