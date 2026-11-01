import { parseConfig } from "@betting/config";
import { createRepositories, openDatabase, type DatabaseHandle, type Repositories } from "@betting/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ensurePlayers, FAVOURITE, SCANNER } from "../players.ts";
import { weeklyReport } from "../weeklyReport.ts";

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
        "truncate players, fixtures, odds_snapshots, bets, passes, api_usage, job_runs, worker_state restart identity cascade",
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
                "Odds API: 40 credits used this month, 460 left.",
                "Too early to judge: 2 of 300 settled bets so far.",
            ].join("\n"),
        );
    });

    it("works before the first bet", async () => {
        const report = await weeklyReport({ repos, config, now: () => now });
        expect(report).toContain("All time: 0 settled (0 won), ROI –, CLV –, bankroll 10,000 kr, 0 open");
        expect(report).not.toContain("Odds API");
    });
});
