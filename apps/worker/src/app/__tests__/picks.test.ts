import { parseConfig } from "@closing-line/config";
import { createRepositories, openDatabase, type DatabaseHandle, type Repositories } from "@closing-line/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { bestPicks } from "../picks.ts";

const config = parseConfig({
    ODDS_API_KEY: "k",
    FOOTBALL_DATA_TOKEN: "t",
    TELEGRAM_BOT_TOKEN: "1:a",
    TELEGRAM_OWNER_CHAT_ID: "1",
});
const now = new Date("2026-11-04T09:00:00Z");
const kickoff = new Date("2026-11-07T15:00:00Z");

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
    await handle.db.execute("truncate fixtures, odds_snapshots restart identity cascade");
});

async function priced(id: string, home: string, away: string, prices: Record<string, [number, number, number]>) {
    await repos.fixtures.upsert([{ id, league: "soccer_efl_champ", homeTeam: home, awayTeam: away, kickoff }]);
    await repos.odds.insert(
        Object.entries(prices).flatMap(([bookmaker, [h, d, a]]) =>
            (["home", "draw", "away"] as const).map((selection, i) => ({
                fixtureId: id,
                bookmaker,
                market: "h2h",
                selection,
                price: [h, d, a][i] ?? 0,
                bookmakerUpdatedAt: new Date(now.getTime() - 3_600_000),
                takenAt: new Date(now.getTime() - 3_600_000),
                kind: "poll" as const,
            })),
        ),
    );
}

describe("bestPicks", () => {
    it("lists prices above fair, best first, marking value at the threshold", async () => {
        await priced("a".repeat(32), "Hull City", "Watford", { pinnacle: [2.5, 3.3, 3.0], unibet_se: [2.5, 3.3, 3.3] });
        await priced("b".repeat(32), "Leeds", "Derby", { pinnacle: [1.8, 3.8, 4.6], nordicbet: [1.86, 3.6, 4.4] });
        const refresh = vi.fn(() => Promise.resolve());
        const text = await bestPicks({ repos, config, now: () => now, refresh });
        expect(refresh).toHaveBeenCalledOnce();
        const lines = text.split("\n");
        expect(lines[0]).toBe("🎯 Best prices for the coming week:");
        expect(lines[2]).toMatch(/^✅ Watford @ 3.30 at Unibet \(\+\d+\.\d%\)$/);
        expect(lines[3]).toBe("   Hull City v Watford, Sat 16:00 · seen 09:00");
        expect(lines[4]).toMatch(/^🟡 Leeds @ 1.86 at NordicBet \(\+[01]\.\d%\)$/);
        expect(text).toContain("✅ value (2%+), like the tips.");
    });

    it("says so when nothing is above fair, or Pinnacle's price is too old", async () => {
        await priced("c".repeat(32), "Leeds", "Derby", { pinnacle: [1.8, 3.8, 4.6], nordicbet: [1.7, 3.5, 4.2] });
        expect(await bestPicks({ repos, config, now: () => now })).toMatch(/^🎯 No prices above the fair price/);
        const later = new Date(now.getTime() + 30 * 3_600_000);
        await priced("d".repeat(32), "Hull City", "Watford", { pinnacle: [2.5, 3.3, 3.0], unibet_se: [2.5, 3.3, 3.3] });
        expect(await bestPicks({ repos, config, now: () => later })).toMatch(/^🎯 No prices above/);
    });
});
