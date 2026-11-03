import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { openDatabase, type DatabaseHandle } from "../client.ts";
import { createRepositories, type NewBet, type Repositories } from "../repositories.ts";

const kickoff = new Date("2026-11-08T16:30:00Z");
const fixture = { id: "evt1", league: "soccer_epl", homeTeam: "Liverpool", awayTeam: "Arsenal", kickoff };

let handle: DatabaseHandle;
let repos: Repositories;

// One database per file (startup and migrations take most of a second); tables are emptied between tests.
// CI sets TEST_DATABASE_URL to run the same tests against a real Postgres server.
beforeAll(async () => {
    const url = process.env.TEST_DATABASE_URL;
    handle = await openDatabase(url ? { kind: "postgres", url } : { kind: "pglite" });
    repos = createRepositories(handle.db);
});

afterAll(async () => {
    await handle.close();
});

beforeEach(async () => {
    await handle.db.execute(
        "truncate players, fixtures, odds_snapshots, bets, passes, api_usage, job_runs, worker_state, chat_sessions restart identity cascade",
    );
    await repos.players.ensure([
        { id: "scanner", name: "Scanner", kind: "scanner", startingBankrollOre: 1_000_000 },
        { id: "friend", name: "Friend", kind: "bettor", startingBankrollOre: 1_000_000 },
    ]);
    await repos.fixtures.upsert([fixture]);
});

function bet(overrides: Partial<NewBet> = {}): NewBet {
    return {
        playerId: "scanner",
        fixtureId: "evt1",
        market: "h2h",
        selection: "away",
        stakeOre: 15_000,
        lockedOdds: 2.54,
        bookmaker: "unibet_se",
        sharpFairOddsAtBet: 2.45,
        edgeAtBet: 0.037,
        ...overrides,
    };
}

/** A bettor's player-prop bet as read from a bet slip, on a match we do not track. */
function slipBet(overrides: Partial<NewBet> = {}): NewBet {
    return {
        playerId: "friend",
        eventName: "Bayern München – Borussia Dortmund",
        competition: "Bundesliga",
        market: "player_shots_on_target",
        selection: "over",
        playerName: "Jobe Bellingham",
        line: 0.5,
        stakeOre: 100_000,
        lockedOdds: 3.4,
        bookmaker: "nordicbet",
        selfReported: true,
        tag: "game_read",
        ...overrides,
    };
}

describe("empty batches", () => {
    it("are no-ops", async () => {
        await repos.players.ensure([]);
        await repos.fixtures.upsert([]);
        await repos.odds.insert([]);
        expect(await repos.players.list()).toHaveLength(2);
    });
});

describe("players", () => {
    it("creates missing players without touching existing ones", async () => {
        await repos.players.ensure([
            { id: "scanner", name: "Renamed", kind: "scanner", startingBankrollOre: 1 },
            { id: "favourite", name: "Favourite", kind: "benchmark", startingBankrollOre: 1_000_000 },
        ]);
        const list = await repos.players.list();
        expect(list.map((player) => [player.id, player.name])).toEqual([
            ["favourite", "Favourite"],
            ["friend", "Friend"],
            ["scanner", "Scanner"],
        ]);
    });
});

describe("fixtures", () => {
    it("moves a rescheduled fixture but keeps a settled result", async () => {
        const later = new Date("2026-11-09T14:00:00Z");
        await repos.fixtures.upsert([{ ...fixture, kickoff: later }]);
        expect((await repos.fixtures.get("evt1"))?.kickoff).toEqual(later);

        await repos.fixtures.setResult("evt1", { status: "finished", homeGoals: 2, awayGoals: 1 });
        await repos.fixtures.upsert([{ ...fixture, kickoff }]);
        const settled = await repos.fixtures.get("evt1");
        expect(settled).toMatchObject({ status: "finished", homeGoals: 2, awayGoals: 1, kickoff: later });
    });

    it("finds fixtures in a window, optionally by status", async () => {
        await repos.fixtures.upsert([
            { ...fixture, id: "evt2", kickoff: new Date("2026-11-08T14:00:00Z") },
            { ...fixture, id: "evt3", kickoff: new Date("2026-11-09T14:00:00Z") },
        ]);
        await repos.fixtures.setResult("evt2", { status: "void" });
        const from = new Date("2026-11-08T00:00:00Z");
        const to = new Date("2026-11-09T00:00:00Z");
        expect((await repos.fixtures.between(from, to)).map((row) => row.id)).toEqual(["evt2", "evt1"]);
        expect((await repos.fixtures.between(from, to, "scheduled")).map((row) => row.id)).toEqual(["evt1"]);
    });

    it("refuses a finished fixture without a score", async () => {
        await expect(handle.db.execute("update fixtures set status = 'finished' where id = 'evt1'")).rejects.toThrow();
    });
});

describe("odds", () => {
    it("returns the newest price per bookmaker and selection", async () => {
        const at = (minutes: number) => new Date(kickoff.getTime() - minutes * 60_000);
        const row = { fixtureId: "evt1", market: "h2h", kind: "poll" as const };
        await repos.odds.insert([
            {
                ...row,
                bookmaker: "pinnacle",
                selection: "away",
                price: 2.47,
                bookmakerUpdatedAt: at(130),
                takenAt: at(120),
            },
            {
                ...row,
                bookmaker: "pinnacle",
                selection: "away",
                price: 2.4,
                bookmakerUpdatedAt: at(31),
                takenAt: at(30),
            },
            {
                ...row,
                bookmaker: "unibet_se",
                selection: "away",
                price: 2.5,
                bookmakerUpdatedAt: at(125),
                takenAt: at(120),
            },
        ]);

        const latest = await repos.odds.latest("evt1");
        expect(latest.map((snapshot) => [snapshot.bookmaker, snapshot.price])).toEqual([
            ["pinnacle", 2.4],
            ["unibet_se", 2.5],
        ]);
        expect((await repos.odds.latest("evt1", at(60))).map((snapshot) => snapshot.bookmaker)).toEqual(["pinnacle"]);
    });

    it("rejects impossible prices", async () => {
        await expect(
            repos.odds.insert([
                {
                    fixtureId: "evt1",
                    market: "h2h",
                    kind: "poll",
                    bookmaker: "pinnacle",
                    selection: "away",
                    price: 1,
                    bookmakerUpdatedAt: kickoff,
                    takenAt: kickoff,
                },
            ]),
        ).rejects.toThrow();
    });
});

describe("bets", () => {
    it("places a bet once per player and selection", async () => {
        const placed = await repos.bets.place(bet());
        expect(placed).toMatchObject({ status: "open", stakeOre: 15_000, reasonTags: [], selfReported: false });
        expect(await repos.bets.place(bet({ stakeOre: 30_000 }))).toBeUndefined();
        expect(await repos.bets.place(bet({ playerId: "friend" }))).toBeDefined();
        expect(await repos.bets.open()).toHaveLength(2);
    });

    it("gives bets time-ordered ids", async () => {
        const first = await repos.bets.place(bet());
        const second = await repos.bets.place(bet({ selection: "draw" }));
        expect(first && second && first.id < second.id).toBe(true);
    });

    it("stores a bettor's bet with its own price and reasons", async () => {
        await repos.bets.place(
            bet({
                playerId: "friend",
                fairPriceEntered: 2.3,
                reasonTags: ["injury", "fatigue"],
                note: "Saka back, Liverpool played Wednesday",
                wouldBetReal: true,
            }),
        );
        const [stored] = await repos.bets.forPlayer("friend");
        expect(stored).toMatchObject({ fairPriceEntered: 2.3, reasonTags: ["injury", "fatigue"], wouldBetReal: true });
    });

    it("records closing odds and settles exactly once", async () => {
        const placed = await repos.bets.place(bet());
        if (!placed) throw new Error("bet not placed");
        await repos.bets.setClosing(placed.id, { fairOdds: 2.4, clv: 0.0583, provisional: true });

        const settledAt = new Date("2026-11-08T18:30:00Z");
        expect(await repos.bets.settle(placed.id, { status: "won", profitOre: 23_100, settledAt })).toBe(true);
        expect(await repos.bets.settle(placed.id, { status: "lost", profitOre: -15_000, settledAt })).toBe(false);

        const [stored] = await repos.bets.forPlayer("scanner");
        expect(stored).toMatchObject({
            status: "won",
            profitOre: 23_100,
            settledAt,
            closingFairOdds: 2.4,
            clv: 0.0583,
            closingProvisional: true,
        });
        expect(await repos.bets.open()).toEqual([]);
    });

    it("lists recent bets with their match, newest first", async () => {
        await repos.bets.place(bet());
        await repos.bets.place(bet({ playerId: "friend", selection: "draw" }));
        const recent = await repos.bets.recent(10);
        expect(recent.map((row) => [row.playerId, row.fixture?.homeTeam, row.fixture?.awayTeam])).toEqual([
            ["friend", "Liverpool", "Arsenal"],
            ["scanner", "Liverpool", "Arsenal"],
        ]);
        expect((await repos.bets.recent(10, "scanner")).map((row) => row.playerId)).toEqual(["scanner"]);
        expect(await repos.bets.recent(1)).toHaveLength(1);
    });

    it("stores a bet from a slip on an event we do not track", async () => {
        const placed = await repos.bets.place(
            slipBet({
                sport: "counter_strike",
                eventName: "Aurora – Team Liquid",
                market: "winner",
                selection: "Team Liquid",
                lockedOdds: 3.25,
                live: true,
            }),
        );
        expect(placed).toMatchObject({ fixtureId: null, sport: "counter_strike", live: true, tag: "game_read" });
        const [listed] = await repos.bets.recent(1);
        expect(listed).toMatchObject({ eventName: "Aurora – Team Liquid", fixture: null });
    });

    it("lets a bettor ladder one player across slips but logs each slip once", async () => {
        const over05 = slipBet({ selection: "over", line: 0.5, couponId: "c1" });
        expect(await repos.bets.place(over05)).toBeDefined();
        expect(await repos.bets.place(slipBet({ selection: "over", line: 1.5, couponId: "c2" }))).toBeDefined();
        expect(await repos.bets.place(slipBet({ selection: "over", line: 0.5, couponId: "c3" }))).toBeDefined();
        expect(await repos.bets.place(over05)).toBeUndefined();
        expect(await repos.bets.forPlayer("friend")).toHaveLength(3);
    });

    it("rejects a bet with neither a fixture nor an event name", async () => {
        await expect(repos.bets.place(slipBet({ fixtureId: null, eventName: null }))).rejects.toThrow();
    });

    it("filters open bets by fixture", async () => {
        await repos.fixtures.upsert([{ ...fixture, id: "evt2" }]);
        await repos.bets.place(bet());
        await repos.bets.place(bet({ fixtureId: "evt2" }));
        expect((await repos.bets.open(["evt2"])).map((row) => row.fixtureId)).toEqual(["evt2"]);
    });

    it("rejects a bet on an unknown fixture, with no stake, or on a team name instead of a 1X2 outcome", async () => {
        await expect(repos.bets.place(bet({ fixtureId: "nope" }))).rejects.toThrow();
        await expect(repos.bets.place(bet({ stakeOre: 0 }))).rejects.toThrow();
        await expect(repos.bets.place(bet({ selection: "Arsenal" }))).rejects.toThrow();
    });

    it("sums each player's bets in the database", async () => {
        const settledAt = new Date("2026-11-08T18:30:00Z");
        const won = await repos.bets.place(bet());
        const lost = await repos.bets.place(bet({ selection: "home", stakeOre: 10_000 }));
        await repos.bets.place(bet({ selection: "draw", stakeOre: 5_000 }));
        await repos.bets.place(bet({ playerId: "friend", stakeOre: 20_000 }));
        await repos.bets.setClosing(won?.id ?? "", { fairOdds: 2.4, clv: 0.06, provisional: false });
        await repos.bets.setClosing(lost?.id ?? "", { fairOdds: 3, clv: -0.02, provisional: false });
        await repos.bets.settle(won?.id ?? "", { status: "won", profitOre: 23_100, settledAt });
        await repos.bets.settle(lost?.id ?? "", { status: "lost", profitOre: -10_000, settledAt });

        const totals = await repos.bets.totals();
        expect(totals.get("scanner")).toEqual({
            settled: 2,
            won: 1,
            void: 0,
            open: 1,
            stakedOre: 25_000,
            profitOre: 13_100,
            openStakeOre: 5_000,
            clvSum: expect.closeTo(0.04, 10) as number,
            clvCount: 2,
        });
        expect(totals.get("friend")).toMatchObject({ open: 1, openStakeOre: 20_000, settled: 0 });

        const sinceSettlement = await repos.bets.totals({ settledSince: new Date(settledAt.getTime() + 1) });
        expect(sinceSettlement.get("scanner")).toBeUndefined();
        expect((await repos.bets.totals({ settledSince: settledAt })).get("scanner")).toMatchObject({
            settled: 2,
            open: 0,
        });
    });

    it("answers whether a player has a bet on a fixture, and lists settled bets for charts", async () => {
        const placed = await repos.bets.place(bet());
        await repos.bets.place(bet({ selection: "home" }));
        expect(await repos.bets.hasBet("scanner", "evt1")).toBe(true);
        expect(await repos.bets.hasBet("friend", "evt1")).toBe(false);

        const settledAt = new Date("2026-11-08T18:30:00Z");
        await repos.bets.settle(placed?.id ?? "", { status: "won", profitOre: 23_100, settledAt });
        expect(await repos.bets.settledLedger("scanner")).toEqual([
            { status: "won", stakeOre: 15_000, profitOre: 23_100, settledAt, clv: null },
        ]);
    });
});

describe("state", () => {
    it("stores and replaces JSON values by key", async () => {
        expect(await repos.state.get("lifecycle")).toBeUndefined();
        await repos.state.set("lifecycle", { running: true });
        await repos.state.set("lifecycle", { running: false, crashAlertedAt: "2026-11-01T10:00:00.000Z" });
        expect(await repos.state.get("lifecycle")).toEqual({
            running: false,
            crashAlertedAt: "2026-11-01T10:00:00.000Z",
        });
    });
});

describe("chats", () => {
    it("stores one session per chat and kind, replacing it on put", async () => {
        const at = new Date("2026-11-03T12:00:00Z");
        const later = new Date("2026-11-03T12:05:00Z");
        expect(await repos.chats.get(200, "bet_draft")).toBeUndefined();
        await repos.chats.put(200, "bet_draft", { step: "sport", draft: {} }, at);
        await repos.chats.put(200, "bet_draft", { step: "match", draft: { sport: "football" } }, later);
        await repos.chats.put(200, "cashout", { betId: "b1" }, at);
        expect(await repos.chats.get(200, "bet_draft")).toEqual({
            value: { step: "match", draft: { sport: "football" } },
            updatedAt: later,
        });

        await repos.chats.remove(200, "bet_draft");
        expect(await repos.chats.get(200, "bet_draft")).toBeUndefined();
        expect(await repos.chats.get(200, "cashout")).toEqual({ value: { betId: "b1" }, updatedAt: at });
    });

    it("keeps Telegram's large group chat ids exact", async () => {
        await repos.chats.put(-1_002_345_678_901, "join_request", { name: "Group" }, new Date());
        expect((await repos.chats.get(-1_002_345_678_901, "join_request"))?.value).toEqual({ name: "Group" });
    });
});

describe("runs", () => {
    it("runs each key once and records how it ended", async () => {
        const at = new Date("2026-11-08T13:30:00Z");
        expect(await repos.runs.start("prekickoff:soccer_epl:2026-11-08T14:00", "prekickoff", at)).toBe(true);
        expect(await repos.runs.start("prekickoff:soccer_epl:2026-11-08T14:00", "prekickoff", at)).toBe(false);
        await repos.runs.finish("prekickoff:soccer_epl:2026-11-08T14:00", {
            status: "skipped",
            message: "daily allowance used",
            finishedAt: at,
        });
        await repos.runs.start("settle:2026-11-08T15", "settle", new Date("2026-11-08T14:15:00Z"));
        await repos.runs.finish("settle:2026-11-08T15", { status: "succeeded", finishedAt: at });

        expect(await repos.runs.keysSince(new Date("2026-11-08T14:00:00Z"))).toEqual(["settle:2026-11-08T15"]);
        const [latest, first] = await repos.runs.recent(2);
        expect(latest).toMatchObject({ key: "settle:2026-11-08T15", status: "succeeded", message: null });
        expect(first).toMatchObject({ status: "skipped", message: "daily allowance used", finishedAt: at });
    });
});

describe("apiUsage", () => {
    it("returns the latest balance per provider", async () => {
        expect(await repos.apiUsage.latest("odds-api")).toBeUndefined();
        const takenAt = new Date("2026-11-01T09:00:00Z");
        await repos.apiUsage.record({ provider: "odds-api", takenAt, used: 1, remaining: 499, lastCost: 1 });
        await repos.apiUsage.record({ provider: "odds-api", takenAt, used: 2, remaining: 498, lastCost: 1 });
        expect(await repos.apiUsage.latest("odds-api")).toMatchObject({ used: 2, remaining: 498 });
    });

    it("returns the last balance before a moment", async () => {
        const yesterday = new Date("2026-11-01T22:00:00Z");
        const today = new Date("2026-11-02T08:00:00Z");
        await repos.apiUsage.record({
            provider: "odds-api",
            takenAt: yesterday,
            used: 10,
            remaining: 490,
            lastCost: 1,
        });
        await repos.apiUsage.record({ provider: "odds-api", takenAt: today, used: 11, remaining: 489, lastCost: 1 });
        await repos.apiUsage.record({ provider: "other", takenAt: yesterday, used: 1, remaining: 9, lastCost: 1 });
        const midnight = new Date("2026-11-02T00:00:00Z");
        expect(await repos.apiUsage.latestBefore("odds-api", midnight)).toMatchObject({ remaining: 490 });
        expect(await repos.apiUsage.latestBefore("odds-api", yesterday)).toBeUndefined();
    });
});
