import { bankrollSeries, statsFromTotals, totalsOf, type BankrollPoint, type PlayerStats } from "@closing-line/core";
import {
    createRepositories,
    openDatabase,
    type BetWithFixture,
    type DatabaseHandle,
    type Player,
} from "@closing-line/db";
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

const cache = globalThis as typeof globalThis & { closingLineDatabase?: Promise<DatabaseHandle> };

/**
 * With DATABASE_URL the dashboard reads the worker's Postgres and never migrates it. Without it, it runs on an
 * in-memory PGlite database filled with demo data, so it can be shown without real data or keys.
 */
function database(): Promise<DatabaseHandle> {
    cache.closingLineDatabase ??= (async () => {
        const url = process.env.DATABASE_URL;
        if (url) return openDatabase({ kind: "postgres", url }, { migrate: false });
        const handle = await openDatabase({ kind: "pglite" });
        await seedDemo(createRepositories(handle.db), new Date());
        return handle;
    })();
    return cache.closingLineDatabase;
}

export async function loadDashboard(): Promise<Dashboard> {
    const repos = createRepositories((await database()).db);
    const totals = await repos.bets.totals();
    const players = await Promise.all(
        (await repos.players.list()).map(async (player) => {
            const stats = statsFromTotals(totals.get(player.id) ?? totalsOf([]));
            const ledger = await repos.bets.settledLedger(player.id);
            return {
                player,
                stats,
                bankrollOre: player.startingBankrollOre + stats.profitOre,
                series: bankrollSeries(player.startingBankrollOre, player.createdAt, ledger),
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
