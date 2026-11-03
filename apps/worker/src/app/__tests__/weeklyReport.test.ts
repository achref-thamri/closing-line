import { parseConfig } from "@closing-line/config";
import { createRepositories, openDatabase, type DatabaseHandle, type Repositories } from "@closing-line/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ensurePlayers, FAVOURITE, SCANNER } from "../players.ts";
import type { Bet } from "@closing-line/db";
import { bettorBreakdown, LESSONS, weeklyReport } from "../weeklyReport.ts";

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
            competition: null,
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
            couponId: null,
            placedAt: null,
            receivedAt: null,
            cashoutOfferOre: null,
            impliedCurrentOdds: null,
            heldStatus: null,
            screenshotPath: "/data/slips/x.jpeg",
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
            ...times(5, { tag: "game_read", status: "lost", profitOre: -100_000, screenshotPath: null }),
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
