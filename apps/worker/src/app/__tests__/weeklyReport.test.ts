import { parseConfig } from "@closing-line/config";
import { createRepositories, openDatabase, type DatabaseHandle, type Repositories } from "@closing-line/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ensurePlayers, FAVOURITE, SCANNER } from "../players.ts";
import type { Bet, DecisionWithResult } from "@closing-line/db";
import {
    allTimeSection,
    bettorBreakdown,
    decisionsSection,
    LESSONS,
    tipsSection,
    weeklyReport,
} from "../weeklyReport.ts";

const config = parseConfig({
    ODDS_API_KEY: "k",
    FOOTBALL_DATA_TOKEN: "t",
    TELEGRAM_BOT_TOKEN: "1:a",
    TELEGRAM_OWNER_CHAT_ID: "1",
});
const now = new Date("2026-11-09T07:00:00Z");

let handle: DatabaseHandle;
let repos: Repositories;

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
});

async function settledBet(id: string, playerId: string, profitOre: number, settledAt: Date, clv: number) {
    await repos.fixtures.upsert([
        { id: id.repeat(32), league: "soccer_epl", homeTeam: "A", awayTeam: "B", kickoff: settledAt },
    ]);
    const bet = await repos.bets.place({
        playerId,
        fixtureId: id.repeat(32),
        market: "h2h",
        selection: "home",
        stakeOre: 10_000,
        lockedOdds: 2.5,
        bookmaker: "unibet_se",
        createdAt: new Date(settledAt.getTime() - 86_400_000),
    });
    if (!bet) throw new Error("not placed");
    await repos.bets.setClosing(bet.id, { fairOdds: 2.4, clv, provisional: true });
    await repos.bets.settle(bet.id, { status: profitOre > 0 ? "won" : "lost", profitOre, settledAt });
}

describe("weeklyReport", () => {
    it("summarises each player's week and all-time results", async () => {
        await settledBet("a", SCANNER, 15_000, new Date("2026-11-07T18:00:00Z"), 0.04);
        await settledBet("b", SCANNER, -10_000, new Date("2026-10-20T18:00:00Z"), -0.02);
        await settledBet("c", FAVOURITE, -10_000, new Date("2026-11-08T18:00:00Z"), 0);
        await repos.apiUsage.record({ provider: "odds-api", takenAt: now, used: 40, remaining: 460, lastCost: 1 });

        expect(await weeklyReport({ repos, config, now: () => now })).toBe(
            [
                "📊 Weekly report, 2 Nov – 9 Nov",
                "",
                "Always the favourite",
                "This week: 1 settled, −100 kr",
                "All time: 1 settled (0 won), ROI −100.0%, CLV +0.0%, bankroll 9,900 kr, 0 open",
                "",
                "Value scanner",
                "This week: 1 settled, +150 kr",
                "All time: 2 settled (1 won), ROI +25.0%, CLV +1.0%, bankroll 10,050 kr, 0 open",
                "",
                "🔎 Tips this week: 1",
                "Average CLV: +4.0% over 1 with a closing price",
                "",
                "📐 All time",
                "Calibration: 0 of 50 settled matches so far.",
                "",
                "📚 Lesson of the week",
                LESSONS[Math.floor(now.getTime() / (7 * 86_400_000)) % LESSONS.length],
                "",
                "Odds API: 40 credits used this month, 460 left.",
                "Too early to judge: 2 of 300 settled bets so far.",
            ].join("\n"),
        );
    });

    it("adds each bettor's breakdown, and a lesson from the numbers once there are some", async () => {
        await repos.players.ensure([
            { id: "tg_2", name: "Sam", kind: "bettor", startingBankrollOre: 6_000_000, telegramChatId: "2" },
        ]);
        for (const [tag, status] of [
            ...Array.from({ length: 5 }, () => ["lineup", "won"] as const),
            ...Array.from({ length: 5 }, () => ["game_read", "lost"] as const),
        ]) {
            const bet = await repos.bets.place({
                playerId: "tg_2",
                eventName: "A – B",
                market: "player_shots_on_target",
                selection: "over",
                stakeOre: 100_000,
                lockedOdds: 3,
                bookmaker: "nordicbet",
                selfReported: true,
                tag,
            });
            await repos.bets.settle(bet?.id ?? "", {
                status,
                profitOre: status === "won" ? 200_000 : -100_000,
                settledAt: now,
            });
        }
        const report = await weeklyReport({ repos, config, now: () => now });
        expect(report).toContain("Sam\nThis week: 10 settled, +5,000 kr");
        expect(report).toContain("By reason: ⚡ Lineup 5 settled, ROI +200.0% · 🧠 Game read 5 settled, ROI −100.0%");
        expect(report).toContain("📚 Lesson of the week\nSam's ⚡ Lineup bets return +200.0% over 5");
    });

    it("works before the first bet", async () => {
        const report = await weeklyReport({ repos, config, now: () => now });
        expect(report).toContain("All time: 0 settled (0 won), ROI –, CLV –, bankroll 10,000 kr, 0 open");
        expect(report).not.toContain("Odds API");
    });
});

describe("bettorBreakdown", () => {
    let n = 0;
    function bet(overrides: Partial<Bet>): Bet {
        n++;
        return {
            id: String(n),
            playerId: "tg_1",
            fixtureId: null,
            sport: "football",
            eventName: "A – B",
            market: "player_shots_on_target",
            selection: "over",
            playerName: "P",
            line: 0.5,
            stakeOre: 100_000,
            lockedOdds: 3,
            bookmaker: "nordicbet",
            sharpFairOddsAtBet: null,
            edgeAtBet: null,
            selfReported: true,
            tag: "lineup",
            receivedAt: null,
            cashoutOfferOre: null,
            impliedCurrentOdds: null,
            heldStatus: null,
            status: "won",
            closingFairOdds: null,
            closingProvisional: null,
            clv: null,
            profitOre: 200_000,
            createdAt: now,
            settledAt: now,
            ...overrides,
        };
    }
    const times = (count: number, overrides: Partial<Bet>) => Array.from({ length: count }, () => bet(overrides));

    it("is empty without bets", () => {
        expect(bettorBreakdown("Sam", [])).toEqual({ lines: [], lessons: [] });
    });

    it("leaves out sections with nothing to show", () => {
        const { lines, lessons } = bettorBreakdown("Sam", [
            bet({ tag: null }),
            bet({ tag: null, status: "cashed_out", cashoutOfferOre: 120_000, profitOre: 20_000 }),
        ]);
        expect(lines).toEqual(["Cash-outs: 1"]);
        expect(lessons).toEqual([]);
    });

    it("breaks results down by reason and sport, and compares reasons", () => {
        const bets = [
            ...times(5, { tag: "lineup" }),
            ...times(5, { tag: "game_read", status: "lost", profitOre: -100_000 }),
            bet({ tag: "game_read", sport: "counter_strike" }),
        ];
        const { lines, lessons } = bettorBreakdown("Sam", bets);
        expect(lines).toEqual([
            "By reason: ⚡ Lineup 5 settled, ROI +200.0% · 🧠 Game read 6 settled, ROI −50.0%",
            "By sport: Football 10 settled, ROI +50.0% · Counter-Strike 1 settled, ROI +200.0%",
        ]);
        expect(lessons).toEqual([
            "Sam's ⚡ Lineup bets return +200.0% over 5, 🧠 Game read bets −50.0% over 6. Lean towards what works, but small samples can still be luck.",
        ]);
    });

    it("shows what cash-outs did against holding, with a lesson once there are three", () => {
        const cashed = { status: "cashed_out" as const, cashoutOfferOre: 150_000, profitOre: 50_000, clv: 0.5 };
        const { lines, lessons } = bettorBreakdown("Sam", [
            ...times(3, { ...cashed, heldStatus: "won" }),
            bet({ ...cashed, heldStatus: null, clv: null }),
        ]);
        // Each held bet would have paid +2,000 kr; each cash-out paid +500 kr.
        expect(lines).toContain("Cash-outs: 4, price moved +50.0% on average; against holding: −4,500 kr over 3");
        expect(lessons).toEqual([
            "Sam's cash-outs cost 4,500 kr compared with holding over 3 bets: the bets kept going their way after the cash-out.",
        ]);
        const lostAnyway = bettorBreakdown("Sam", times(3, { ...cashed, heldStatus: "lost" }));
        expect(lostAnyway.lessons[0]).toMatch(/^Sam's cash-outs paid 4,500 kr more than holding over 3 bets/);
    });
});

describe("tipsSection", () => {
    const sentAt = new Date("2026-11-07T08:00:00Z");
    const tip = (clv: number | null) => ({ lockedOdds: 2.5, createdAt: sentAt, clv }) as Bet;
    const seen = (hours: number, price: number, kind = "poll") => ({
        price,
        takenAt: new Date(sentAt.getTime() + hours * 3_600_000),
        kind,
    });

    it("says how often a tip's price lasted, and what to do once there are enough tips", () => {
        const lasted = { bet: tip(0.03), later: [seen(3, 2.5), seen(9, 2.55, "closing")] };
        const gone = { bet: tip(0.05), later: [seen(3, 2.4), seen(9, 2.3, "closing")] };
        const unseen = { bet: tip(null), later: [] };
        expect(tipsSection([lasted, gone, unseen])).toEqual([
            "",
            "🔎 Tips this week: 3",
            "Price still there at the next poll: 1 of 2",
            "Price still there just before kickoff: 1 of 2",
            "Average CLV: +4.0% over 2 with a closing price",
        ]);
        expect(tipsSection(Array.from({ length: 5 }, () => gone)).at(-1)).toBe(
            "Most tip prices are gone by kickoff: bet soon after a tip arrives.",
        );
        expect(tipsSection(Array.from({ length: 5 }, () => lasted)).at(-1)).toMatch(
            /^Most tip prices last until kickoff/,
        );
        expect(tipsSection([])).toEqual([]);
    });
});

describe("decisionsSection", () => {
    const decision = (overrides: Partial<DecisionWithResult>): DecisionWithResult => ({
        id: 1,
        fixtureId: "f1",
        takenAt: new Date("2026-11-07T08:00:00Z"),
        minutesToKickoff: 480,
        outcome: "pass",
        reason: "no_edge",
        bestSelection: "home",
        bestBookmaker: "unibet_se",
        bestOdds: 2.1,
        bestEdge: -0.01,
        fairHome: 0.47,
        fairDraw: 0.27,
        fairAway: 0.26,
        league: "soccer_epl",
        status: "finished",
        homeGoals: 0,
        awayGoals: 1,
        ...overrides,
    });

    it("counts bets and passes by reason, and tests the passes against the results", () => {
        expect(
            decisionsSection([
                decision({ fixtureId: "f1", outcome: "bet", reason: "value", bestEdge: 0.05 }),
                decision({ fixtureId: "f1", reason: "already_bet" }),
                decision({ fixtureId: "f2", homeGoals: 2, awayGoals: 0 }),
                decision({ fixtureId: "f3" }),
                decision({ fixtureId: "f4", status: "scheduled", homeGoals: null, awayGoals: null }),
                decision({ fixtureId: "f5", reason: "no_fresh_sharp", bestOdds: null, bestSelection: null }),
            ]),
        ).toEqual([
            "",
            "🧭 Decisions this week: 5 matches looked at 6 times, 1 bet, 5 passed (17% bet rate)",
            "Passed for: 3 no edge, 1 no fresh Pinnacle price, 1 already bet",
            // f2 won at 2.10 (+1.10) and f3 lost (−1): +5.0% over 2.
            "Backing the best price on each settled no-edge pass would have returned +5.0% over 2.",
        ]);
        expect(decisionsSection([])).toEqual([]);
    });
});

describe("allTimeSection", () => {
    const names = new Map([["soccer_epl", "Premier League"]]);
    const match = (id: number, home: number, away: number, fairHome: number): DecisionWithResult => ({
        id,
        fixtureId: `f${id}`,
        takenAt: new Date("2026-11-07T08:00:00Z"),
        minutesToKickoff: 480,
        outcome: "pass",
        reason: "no_edge",
        bestSelection: "home",
        bestBookmaker: "unibet_se",
        bestOdds: 2,
        bestEdge: 0,
        fairHome,
        fairDraw: 0.25,
        fairAway: 0.75 - fairHome,
        league: "soccer_epl",
        status: "finished",
        homeGoals: home,
        awayGoals: away,
    });
    const scannerBet = (hoursBefore: number, profitOre: number) => {
        const kickoff = new Date("2026-11-07T15:00:00Z");
        return {
            stakeOre: 10_000,
            status: profitOre > 0 ? "won" : "lost",
            profitOre,
            settledAt: kickoff,
            clv: 0.02,
            createdAt: new Date(kickoff.getTime() - hoursBefore * 3_600_000),
            league: "soccer_epl",
            kickoff,
        } as Bet & { league: string; kickoff: Date };
    };

    it("waits for enough matches before showing calibration, and hides small groups", () => {
        expect(allTimeSection([match(1, 1, 0, 0.5)], [scannerBet(1, 10_000)], names)).toEqual([
            "",
            "📐 All time",
            "Calibration: 1 of 50 settled matches so far.",
        ]);
    });

    it("compares what Pinnacle said with what happened, and breaks the scanner's bets down", () => {
        // 60 matches with the home side at 50%; 30 home wins. A second decision on a match does not count again.
        const decisions = Array.from({ length: 60 }, (_, i) => match(i, i < 30 ? 1 : 0, i < 30 ? 0 : 1, 0.5));
        decisions.push({ ...match(0, 1, 0, 0.9), id: 99 });
        const bets = [...Array.from({ length: 10 }, () => scannerBet(1, 10_000)), scannerBet(20, -10_000)];
        expect(allTimeSection(decisions, bets, names)).toEqual([
            "",
            "📐 All time",
            "Calibration of Pinnacle's fair prices over 60 matches:",
            "20–40%: said 25%, happened 25% (120)",
            "40–60%: said 50%, happened 50% (60)",
            "Log loss 1.040 (Pinnacle's early price in the back-test: 1.007), Brier 0.625. Lower is better.",
            "Scanner by league:",
            "Premier League: 11 bets, ROI +81.8%, CLV +2.0%",
            "Scanner by time before kickoff:",
            "under 2 h: 10 bets, ROI +100.0%, CLV +2.0%",
        ]);
    });
});
