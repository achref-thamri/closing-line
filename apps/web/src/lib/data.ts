import { bankrollSeries, playerStats, type BankrollPoint, type PlayerStats } from "@betting/core";
import { createRepositories, openDatabase, type BetWithFixture, type DatabaseHandle, type Player } from "@betting/db";
import { seedDemo } from "./demo.ts";

export interface PlayerSummary {
    player: Player;
    stats: PlayerStats;
    bankrollOre: number;
    series: BankrollPoint[];
}

export interface Dashboard {
    demo: boolean;
    players: PlayerSummary[];
    recentBets: BetWithFixture[];
    credits: { used: number; remaining: number } | undefined;
}

const cache = globalThis as typeof globalThis & { bettingDatabase?: Promise<DatabaseHandle> };

/**
 * With DATABASE_URL the dashboard reads the worker's Postgres and never migrates it. Without it, it runs on an
 * in-memory PGlite database filled with demo data, so it can be shown without real data or keys.
 */
function database(): Promise<DatabaseHandle> {
    cache.bettingDatabase ??= (async () => {
        const url = process.env.DATABASE_URL;
        if (url) return openDatabase({ kind: "postgres", url }, { migrate: false });
        const handle = await openDatabase({ kind: "pglite" });
        await seedDemo(createRepositories(handle.db), new Date());
        return handle;
    })();
    return cache.bettingDatabase;
}

export async function loadDashboard(): Promise<Dashboard> {
    const repos = createRepositories((await database()).db);
    const players = await Promise.all(
        (await repos.players.list()).map(async (player) => {
            const bets = await repos.bets.forPlayer(player.id);
            const stats = playerStats(bets);
            const start = bets[0]?.createdAt ?? player.createdAt;
            return {
                player,
                stats,
                bankrollOre: player.startingBankrollOre + stats.profitOre,
                series: bankrollSeries(player.startingBankrollOre, start, bets),
            };
        }),
    );
    players.sort((a, b) => b.bankrollOre - a.bankrollOre);
    const usage = await repos.apiUsage.latest("odds-api");
    return {
        demo: !process.env.DATABASE_URL,
        players,
        recentBets: await repos.bets.recent(50),
        credits: usage && { used: usage.used, remaining: usage.remaining },
    };
}
