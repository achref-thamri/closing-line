import { parseConfig } from "@closing-line/config";
import { createRepositories, openDatabase, type DatabaseHandle, type Repositories } from "@closing-line/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { EventOdds, Priced, Quote } from "../../ports/odds.ts";
import type { Spent } from "../creditGuard.ts";
import { ensurePlayers, FAVOURITE, SCANNER } from "../players.ts";
import { pollOdds, type PollOddsDeps } from "../pollOdds.ts";
import { syncFixtures } from "../syncFixtures.ts";

const config = parseConfig({
    ODDS_API_KEY: "k",
    FOOTBALL_DATA_TOKEN: "t",
    TELEGRAM_BOT_TOKEN: "1:a",
    TELEGRAM_OWNER_CHAT_ID: "1",
});
const balance = { used: 1, remaining: 499, lastCost: 1, takenAt: new Date() };

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
    now = new Date("2026-11-08T12:00:00Z");
    messages = [];
});

function quotes(bookmaker: string, home: number, draw: number, away: number, updatedAt = now): Quote[] {
    return [
        { bookmaker, market: "h2h", selection: "home", price: home, updatedAt },
        { bookmaker, market: "h2h", selection: "draw", price: draw, updatedAt },
        { bookmaker, market: "h2h", selection: "away", price: away, updatedAt },
    ];
}

function event(minutesToKickoff: number, extra: Quote[] = [], id = "a".repeat(32)): EventOdds {
    return {
        id,
        league: "soccer_epl",
        homeTeam: "Liverpool",
        awayTeam: "Arsenal",
        kickoff: new Date(now.getTime() + minutesToKickoff * 60_000),
        // Pinnacle's fair odds here are about 3.06 / 3.56 / 2.54.
        quotes: [...quotes("pinnacle", 2.96, 3.43, 2.47), ...extra],
    };
}

function deps(events: EventOdds[], spend?: Spent<EventOdds[]>): PollOddsDeps {
    return {
        source: { odds: vi.fn(() => Promise.resolve<Priced<EventOdds[]>>({ data: events, balance })) },
        guard: {
            spend: <T>(_cost: number, _priority: string, call: () => Promise<Priced<T>>) =>
                spend ? Promise.resolve(spend as Spent<T>) : call().then(({ data }) => ({ ok: true as const, data })),
        },
        repos,
        config,
        now: () => now,
        notify: (message) => {
            messages.push(message);
            return Promise.resolve();
        },
    };
}

describe("pollOdds", () => {
    it("stores the fixture and every price", async () => {
        const report = await pollOdds(
            deps([event(24 * 60, quotes("unibet_se", 2.9, 3.4, 2.45))]),
            "soccer_epl",
            "scan",
        );
        expect(report).toEqual({ skipped: false, events: 1, scannerBets: 0, favouriteBets: 0, closingUpdates: 0 });
        expect(await repos.fixtures.get("a".repeat(32))).toMatchObject({ homeTeam: "Liverpool", status: "scheduled" });
        expect(await repos.odds.latest("a".repeat(32))).toHaveLength(6);
    });

    it("lets the scanner bet on value, once, and says so", async () => {
        const poll = deps([event(24 * 60, quotes("unibet_se", 2.9, 3.4, 2.75))]);
        expect(await pollOdds(poll, "soccer_epl", "scan")).toMatchObject({ scannerBets: 1 });
        expect(await pollOdds(poll, "soccer_epl", "scan")).toMatchObject({ scannerBets: 0 });

        const [bet] = await repos.bets.forPlayer(SCANNER);
        expect(bet).toMatchObject({ selection: "away", bookmaker: "unibet_se", lockedOdds: 2.75, status: "open" });
        expect(bet?.edgeAtBet).toBeGreaterThan(0.03);
        // Edge 8.2%, full Kelly 4.7%, quarter 1.17% of 10,000 kr, rounded down to 110 kr.
        expect(bet?.stakeOre).toBe(11_000);
        expect(messages).toEqual([
            "🔎 Value bet: Arsenal @ 2.75 (unibet_se)\nLiverpool v Arsenal, Mon 13:00\nFair 2.54, edge 8.2%, paper stake 110 kr\n" +
                "💡 Pinnacle, the sharpest bookmaker, prices this at 2.54 once its margin is removed. 2.75 pays 8.2% " +
                "more than the bet is worth, so it wins money over many bets like it, not every time.",
        ]);
    });

    it("locks exchange bets at the odds after commission", async () => {
        await pollOdds(deps([event(24 * 60, quotes("betfair_ex_eu", 2.9, 3.4, 2.8))]), "soccer_epl", "scan");
        const [bet] = await repos.bets.forPlayer(SCANNER);
        expect(bet?.lockedOdds).toBeCloseTo(2.71);
    });

    it("does not bet without a fresh sharp price or after kickoff", async () => {
        const stale = event(24 * 60, quotes("unibet_se", 2.9, 3.4, 2.75));
        stale.quotes = [
            ...quotes("pinnacle", 2.96, 3.43, 2.47, new Date(now.getTime() - 30 * 60_000)),
            ...stale.quotes.slice(3),
        ];
        const started = event(-5, quotes("unibet_se", 2.9, 3.4, 2.75), "b".repeat(32));
        expect(await pollOdds(deps([stale, started]), "soccer_epl", "scan")).toMatchObject({
            scannerBets: 0,
            events: 2,
        });
        expect(await repos.odds.latest("b".repeat(32))).toHaveLength(6);
    });

    it("records closing prices and backs the favourite near kickoff", async () => {
        await pollOdds(deps([event(24 * 60, quotes("unibet_se", 2.9, 3.4, 2.75))]), "soccer_epl", "scan");
        now = new Date(now.getTime() + (24 * 60 - 30) * 60_000);
        const report = await pollOdds(deps([event(30)]), "soccer_epl", "closing");
        expect(report).toMatchObject({ favouriteBets: 1, closingUpdates: 2 });

        const [scanner] = await repos.bets.forPlayer(SCANNER);
        expect(scanner?.closingProvisional).toBe(false);
        expect(scanner?.closingFairOdds).toBeCloseTo(2.542, 3);
        expect(scanner?.clv).toBeCloseTo(2.75 / (scanner?.closingFairOdds ?? 1) - 1);

        const [favourite] = await repos.bets.forPlayer(FAVOURITE);
        expect(favourite).toMatchObject({
            selection: "away",
            lockedOdds: 2.47,
            bookmaker: "pinnacle",
            stakeOre: 10_000,
        });
        const latest = await repos.odds.latest("a".repeat(32));
        expect(latest.filter((row) => row.bookmaker === "pinnacle").map((row) => row.kind)).toEqual([
            "closing",
            "closing",
            "closing",
        ]);

        await pollOdds(deps([event(30)]), "soccer_epl", "closing");
        expect(await repos.bets.forPlayer(FAVOURITE)).toHaveLength(1);
    });

    it("skips stakes below the minimum", async () => {
        // 2.62 is a 3.05% edge, enough to bet, but quarter-Kelly stakes only about 47 kr, under the 50 kr minimum.
        await pollOdds(deps([event(24 * 60, quotes("unibet_se", 2.9, 3.4, 2.62))]), "soccer_epl", "scan");
        expect(await repos.bets.forPlayer(SCANNER)).toEqual([]);
    });

    it("pauses the scanner after a bad week", async () => {
        await repos.fixtures.upsert([
            { id: "c".repeat(32), league: "soccer_epl", homeTeam: "A", awayTeam: "B", kickoff: now },
        ]);
        const lost = await repos.bets.place({
            playerId: SCANNER,
            fixtureId: "c".repeat(32),
            market: "h2h",
            selection: "home",
            stakeOre: 150_000,
            lockedOdds: 2,
            bookmaker: "unibet_se",
        });
        await repos.bets.settle(lost?.id ?? "", { status: "lost", profitOre: -150_000, settledAt: now });
        expect(
            await pollOdds(deps([event(24 * 60, quotes("unibet_se", 2.9, 3.4, 2.75))]), "soccer_epl", "scan"),
        ).toMatchObject({
            scannerBets: 0,
        });
    });

    it("does nothing when the credit guard says no", async () => {
        const poll = deps([event(60)], { ok: false, reason: "daily allowance of 15 credits used (15 spent today)" });
        expect(await pollOdds(poll, "soccer_epl", "scan")).toEqual({
            skipped: true,
            reason: "daily allowance of 15 credits used (15 spent today)",
        });
        expect(poll.source.odds).not.toHaveBeenCalled();
    });
});

describe("syncFixtures", () => {
    it("stores fixtures for every league and records the free balance", async () => {
        const record = vi.fn(() => Promise.resolve());
        const { quotes: _quotes, ...info } = event(60);
        const count = await syncFixtures({
            source: { events: () => Promise.resolve({ data: [info], balance }) },
            guard: { record },
            repos,
            config,
        });
        // The fake source returns the same event for each of the four default leagues.
        expect(count).toBe(4);
        expect(record).toHaveBeenCalledWith(balance);
        expect(await repos.fixtures.get(info.id)).toBeDefined();
    });
});
