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
        "truncate players, fixtures, odds_snapshots, bets, passes, api_usage, job_runs, worker_state restart identity cascade",
    );
    await repos.players.ensure([
        { id: "scanner", name: "Scanner", kind: "scanner", startingBankrollOre: 1_000_000 },
        { id: "friend", name: "Friend", kind: "human", startingBankrollOre: 1_000_000 },
    ]);
    await repos.fixtures.upsert([fixture]);
});

function bet(overrides: Partial<NewBet> = {}): NewBet {
    return {
        playerId: "scanner",
        fixtureId: "evt1",
        market: "h2h",
        selection: "Arsenal",
        stakeOre: 15_000,
        lockedOdds: 2.54,
        bookmaker: "unibet_se",
        sharpFairOddsAtBet: 2.45,
        edgeAtBet: 0.037,
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
                selection: "Arsenal",
                price: 2.47,
                bookmakerUpdatedAt: at(130),
                takenAt: at(120),
            },
            {
                ...row,
                bookmaker: "pinnacle",
                selection: "Arsenal",
                price: 2.4,
                bookmakerUpdatedAt: at(31),
                takenAt: at(30),
            },
            {
                ...row,
                bookmaker: "unibet_se",
                selection: "Arsenal",
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
                    selection: "Arsenal",
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
        const second = await repos.bets.place(bet({ selection: "Draw" }));
        expect(first && second && first.id < second.id).toBe(true);
    });

    it("stores a human bet with its own price and reasons", async () => {
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
        await repos.bets.place(bet({ playerId: "friend", selection: "Draw" }));
        const recent = await repos.bets.recent(10);
        expect(recent.map((row) => [row.playerId, row.fixture.homeTeam, row.fixture.awayTeam])).toEqual([
            ["friend", "Liverpool", "Arsenal"],
            ["scanner", "Liverpool", "Arsenal"],
        ]);
        expect((await repos.bets.recent(10, "scanner")).map((row) => row.playerId)).toEqual(["scanner"]);
        expect(await repos.bets.recent(1)).toHaveLength(1);
    });

    it("filters open bets by fixture", async () => {
        await repos.fixtures.upsert([{ ...fixture, id: "evt2" }]);
        await repos.bets.place(bet());
        await repos.bets.place(bet({ fixtureId: "evt2" }));
        expect((await repos.bets.open(["evt2"])).map((row) => row.fixtureId)).toEqual(["evt2"]);
    });

    it("rejects a bet on an unknown fixture or with no stake", async () => {
        await expect(repos.bets.place(bet({ fixtureId: "nope" }))).rejects.toThrow();
        await expect(repos.bets.place(bet({ stakeOre: 0 }))).rejects.toThrow();
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
