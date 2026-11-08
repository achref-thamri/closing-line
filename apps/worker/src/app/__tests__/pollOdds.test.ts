import { parseConfig } from "@closing-line/config";
import { createRepositories, openDatabase, type DatabaseHandle, type Repositories } from "@closing-line/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { EventOdds, Priced, Quote } from "../../ports/odds.ts";
import type { Spent } from "../creditGuard.ts";
import { ensurePlayers, FAVOURITE, SCANNER } from "../players.ts";
import { pollOdds, type PollOddsDeps } from "../pollOdds.ts";
import { syncFixtures } from "../syncFixtures.ts";
import type { PriceGone, Tip } from "../tips.ts";

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
        "truncate players, fixtures, odds_snapshots, bets, api_usage, job_runs, worker_state, chat_sessions restart identity cascade",
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
            "🔎 Value bet: Arsenal @ 2.75 at Unibet\nLiverpool v Arsenal, Mon 13:00\nFair 2.54, edge 8.2%, paper stake 110 kr\n" +
                "💡 Pinnacle, the sharpest bookmaker, prices this at 2.54 once its margin is removed. 2.75 pays 8.2% " +
                "more than the bet is worth, so it wins money over many bets like it, not every time.\n" +
                "Price seen 13:00. Worth it at 2.60 or better, so check your bookmaker's price first.",
        ]);
    });

    it("says once when no bookmaker pays the fair price for a tip any more", async () => {
        await pollOdds(deps([event(24 * 60, quotes("unibet_se", 2.9, 3.4, 2.75))]), "soccer_epl", "scan");
        expect(messages).toHaveLength(1);

        now = new Date(now.getTime() + 3_600_000);
        const later = deps([event(23 * 60, quotes("unibet_se", 2.9, 3.4, 2.45))]);
        await pollOdds(later, "soccer_epl", "scan");
        // The tip time is the bet's createdAt, which the database sets from its own clock.
        expect(messages[1]).toMatch(
            /^⌛ Price gone: Arsenal, tipped at 2\.75 on \w{3} \d\d:\d\d\nLiverpool v Arsenal, Mon 13:00\nBest now 2\.45 at Unibet, below the fair 2\.54\. If you haven't bet it, skip it\. If you have, you got the better price\.$/,
        );
        const [bet] = await repos.bets.forPlayer(SCANNER);
        expect(bet?.priceGoneAt).toEqual(now);

        now = new Date(now.getTime() + 3_600_000);
        await pollOdds(deps([event(22 * 60, quotes("unibet_se", 2.9, 3.4, 2.45))]), "soccer_epl", "scan");
        expect(messages).toHaveLength(2);
    });

    it("alerts once when two polls of the same league find the price gone together", async () => {
        await pollOdds(deps([event(24 * 60, quotes("unibet_se", 2.9, 3.4, 2.75))]), "soccer_epl", "scan");
        now = new Date(now.getTime() + 3_600_000);
        const later = event(23 * 60, quotes("unibet_se", 2.9, 3.4, 2.45));
        // A /picks refresh and a scheduled poll, both reading the tip before either marks it.
        await Promise.all([
            pollOdds(deps([later]), "soccer_epl", "scan"),
            pollOdds(deps([later]), "soccer_epl", "scan"),
        ]);
        expect(messages.filter((message) => message.startsWith("⌛"))).toHaveLength(1);
    });

    it("keeps quiet while a bookmaker still pays at least the fair price", async () => {
        const gone: PriceGone[] = [];
        const poll = (events: EventOdds[]) => ({
            ...deps(events),
            priceGone: (alert: PriceGone) => {
                gone.push(alert);
                return Promise.resolve();
            },
        });
        await pollOdds(poll([event(24 * 60, quotes("unibet_se", 2.9, 3.4, 2.75))]), "soccer_epl", "scan");
        now = new Date(now.getTime() + 3_600_000);
        await pollOdds(poll([event(23 * 60, quotes("unibet_se", 2.9, 3.4, 2.6))]), "soccer_epl", "scan");
        expect(gone).toEqual([]);
        await pollOdds(poll([event(23 * 60, quotes("unibet_se", 2.9, 3.4, 2.5))]), "soccer_epl", "scan");
        expect(gone).toMatchObject([
            { pick: "Arsenal", tippedOdds: 2.75, best: { bookmaker: "unibet_se", offeredOdds: 2.5 } },
        ]);
    });

    it("hands the tip to the tip sender with every book that pays enough", async () => {
        const tips: Tip[] = [];
        const poll = {
            ...deps([event(24 * 60, [...quotes("unibet_se", 2.9, 3.4, 2.75), ...quotes("nordicbet", 2.9, 3.4, 2.7)])]),
            tip: (tip: Tip) => {
                tips.push(tip);
                return Promise.resolve();
            },
        };
        await pollOdds(poll, "soccer_epl", "scan");
        expect(messages).toEqual([]);
        expect(tips).toMatchObject([{ pick: "Arsenal", paperStakeKr: 110, seenAt: now }]);
        expect(tips[0]?.offers.map((offer) => offer.bookmaker)).toEqual(["unibet_se", "nordicbet"]);
    });

    it("sizes each value bet on what the bets before it in the same poll left, reading totals once", async () => {
        const fullKelly = parseConfig(
            { ODDS_API_KEY: "k", FOOTBALL_DATA_TOKEN: "t", TELEGRAM_BOT_TOKEN: "1:a", TELEGRAM_OWNER_CHAT_ID: "1" },
            {
                startingBankroll: 1_000,
                scanner: {
                    stake: { kellyMultiplier: 1, maxBankrollFraction: 1, minStake: 1, maxStake: 1_000, step: 1 },
                },
            },
        );
        const value = quotes("unibet_se", 2.9, 3.4, 2.75);
        const poll = {
            ...deps([event(24 * 60, value, "a".repeat(32)), event(25 * 60, value, "b".repeat(32))]),
            config: fullKelly,
        };
        const totals = vi.spyOn(repos.bets, "totals");
        expect(await pollOdds(poll, "soccer_epl", "scan")).toMatchObject({ scannerBets: 2 });
        // Full Kelly is 4.6%: 46 kr of 1,000, then 44 kr of the 954 left.
        expect((await repos.bets.forPlayer(SCANNER)).map((bet) => bet.stakeOre)).toEqual([4_600, 4_400]);
        // One read for the weekly loss pause, one for the bankroll.
        expect(totals).toHaveBeenCalledTimes(2);
        totals.mockRestore();
    });

    it("locks exchange bets at the odds after commission", async () => {
        const poll = {
            ...deps([event(24 * 60, quotes("betfair_ex_eu", 2.9, 3.4, 2.8))]),
            config: { ...config, exchangeCommission: { betfair_ex_eu: 0.05 } },
        };
        await pollOdds(poll, "soccer_epl", "scan");
        const [bet] = await repos.bets.forPlayer(SCANNER);
        expect(bet?.lockedOdds).toBeCloseTo(2.71);
    });

    it("sends no tip on an outsider, however big the edge", async () => {
        const longshot: EventOdds = {
            ...event(24 * 60),
            // Pinnacle's fair odds here are about 1.39 / 5.0 / 9.0; Unibet's 10.0 on Arsenal is an 11% edge.
            quotes: [...quotes("pinnacle", 1.36, 4.9, 8.6), ...quotes("unibet_se", 1.36, 4.9, 10.0)],
        };
        expect(await pollOdds(deps([longshot]), "soccer_epl", "scan")).toMatchObject({ scannerBets: 0 });
        expect(messages).toEqual([]);
        const [decision] = await repos.decisions.since(now);
        expect(decision).toMatchObject({ outcome: "pass", reason: "no_edge" });
    });

    it("records a pass and sends no tip for a match more than three days out", async () => {
        const far = event(72 * 60 + 1, quotes("unibet_se", 2.9, 3.4, 2.75));
        expect(await pollOdds(deps([far]), "soccer_epl", "scan")).toMatchObject({ scannerBets: 0 });
        expect(messages).toEqual([]);
        const [decision] = await repos.decisions.since(now);
        expect(decision).toMatchObject({ outcome: "pass", reason: "too_early", bestBookmaker: "unibet_se" });

        now = new Date(now.getTime() + 60_000);
        expect(await pollOdds(deps([far]), "soccer_epl", "scan")).toMatchObject({ scannerBets: 1 });
    });

    it("gives closing prices to match-result bets only", async () => {
        await repos.fixtures.upsert([event(30)]);
        await repos.bets.place({
            playerId: SCANNER,
            fixtureId: "a".repeat(32),
            market: "player_shots",
            selection: "over",
            playerName: "Saka",
            line: 1.5,
            stakeOre: 10_000,
            lockedOdds: 1.9,
            bookmaker: "bet25",
            selfReported: true,
        });
        expect(await pollOdds(deps([event(30)]), "soccer_epl", "closing")).toMatchObject({ closingUpdates: 1 });
        const bets = await repos.bets.forPlayer(SCANNER);
        expect(bets.find((bet) => bet.market === "player_shots")?.clv).toBeNull();
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

    it("raises a small Kelly stake to the minimum, so the value bet is still placed and tipped", async () => {
        // 2.62 is a 3.05% edge, enough to bet, but quarter-Kelly stakes only about 47 kr, under the 50 kr minimum.
        await pollOdds(deps([event(24 * 60, quotes("unibet_se", 2.9, 3.4, 2.62))]), "soccer_epl", "scan");
        expect((await repos.bets.forPlayer(SCANNER)).map((bet) => bet.stakeOre)).toEqual([5_000]);
        expect(messages).toHaveLength(1);
        expect((await repos.decisions.since(now)).map((decision) => decision.reason)).toEqual(["value"]);
    });

    it("passes when the bankroll cannot cover the minimum stake within its 2% cap", async () => {
        const small = parseConfig(
            { ODDS_API_KEY: "k", FOOTBALL_DATA_TOKEN: "t", TELEGRAM_BOT_TOKEN: "1:a", TELEGRAM_OWNER_CHAT_ID: "1" },
            { startingBankroll: 2_000 },
        );
        // 2% of 2,000 kr is 40 kr, under the 50 kr minimum.
        await pollOdds(
            { ...deps([event(24 * 60, quotes("unibet_se", 2.9, 3.4, 2.62))]), config: small },
            "soccer_epl",
            "scan",
        );
        expect(await repos.bets.forPlayer(SCANNER)).toEqual([]);
        expect((await repos.decisions.since(now)).map((decision) => decision.reason)).toEqual(["stake_too_small"]);
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
        expect((await repos.decisions.since(now)).map((decision) => decision.reason)).toEqual(["paused"]);
    });

    it("records a decision for every match it looks at: the bet, or the pass and why", async () => {
        const value = event(24 * 60, quotes("unibet_se", 2.9, 3.4, 2.75), "a".repeat(32));
        const none = event(25 * 60, quotes("unibet_se", 2.8, 3.3, 2.4), "b".repeat(32));
        const stale = event(26 * 60, quotes("unibet_se", 2.9, 3.4, 2.75), "c".repeat(32));
        stale.quotes = [
            ...quotes("pinnacle", 2.96, 3.43, 2.47, new Date(now.getTime() - 30 * 60_000)),
            ...stale.quotes.slice(3),
        ];
        const started = event(-5, quotes("unibet_se", 2.9, 3.4, 2.75), "d".repeat(32));
        expect(await pollOdds(deps([value, none, stale, started]), "soccer_epl", "scan")).toMatchObject({
            scannerBets: 1,
        });
        await pollOdds(deps([value]), "soccer_epl", "scan");
        // A match already under way gets no decision, but its prices are still stored.
        expect(await repos.odds.latest("d".repeat(32))).toHaveLength(6);

        const decisions = await repos.decisions.since(now);
        expect(decisions.map((decision) => [decision.fixtureId[0], decision.outcome, decision.reason])).toEqual([
            ["a", "bet", "value"],
            ["b", "pass", "no_edge"],
            ["c", "pass", "no_fresh_sharp"],
            ["a", "pass", "already_bet"],
        ]);
        const [bet, pass] = decisions;
        expect(bet).toMatchObject({
            minutesToKickoff: 1440,
            bestSelection: "away",
            bestBookmaker: "unibet_se",
            bestOdds: 2.75,
        });
        expect(bet?.bestEdge).toBeGreaterThan(0.08);
        expect(pass?.bestEdge).toBeLessThan(0.02);
        expect((bet?.fairHome ?? 0) + (bet?.fairDraw ?? 0) + (bet?.fairAway ?? 0)).toBeCloseTo(1, 9);
        expect(decisions[2]).toMatchObject({ bestOdds: null, fairHome: null });
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
        // The fake source returns the same event for each of the six default leagues.
        expect(count).toBe(6);
        expect(record).toHaveBeenCalledWith(balance);
        expect(await repos.fixtures.get(info.id)).toBeDefined();
    });
});
