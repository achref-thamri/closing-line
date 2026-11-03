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
    /** Profit as a share of the starting bankroll, so players who start with different bankrolls compare fairly. */
    growth: number;
    series: BankrollPoint[];
}

/** Best growth first; players level on growth keep their order. */
export function byGrowth(a: Pick<PlayerSummary, "growth">, b: Pick<PlayerSummary, "growth">): number {
    return b.growth - a.growth;
}

/** Bets per page in the dashboard's table. */
export const BETS_PER_PAGE = 50;

export interface BetCounts {
    total: number;
    open: number;
    /** Won, lost, cashed out or void. */
    settled: number;
}

export interface Dashboard {
    demo: boolean;
    players: PlayerSummary[];
    betCounts: BetCounts;
    /** 1-based, already clamped to the pages that exist. */
    page: number;
    pages: number;
    bets: BetWithFixture[];
    credits: { used: number; remaining: number } | undefined;
}

/** Reads `?page=` leniently: anything that is not a whole number falls back to the first page, too high to the last. */
export function pageOf(requested: string | undefined, total: number, perPage = BETS_PER_PAGE) {
    const pages = Math.max(1, Math.ceil(total / perPage));
    const asked = Number(requested);
    const page = Number.isInteger(asked) && asked >= 1 ? Math.min(asked, pages) : 1;
    return { page, pages };
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

export async function loadDashboard(requestedPage?: string): Promise<Dashboard> {
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
                growth: stats.profitOre / player.startingBankrollOre,
                series: bankrollSeries(player.startingBankrollOre, player.createdAt, ledger),
            };
        }),
    );
    // Bettors start with 60,000 kr and the automated players with 10,000 kr, so kroner would rank bettors first.
    players.sort(byGrowth);
    const betCounts = { total: 0, open: 0, settled: 0 };
    for (const { stats } of players) {
        betCounts.open += stats.open;
        betCounts.settled += stats.settled + stats.void;
    }
    betCounts.total = betCounts.open + betCounts.settled;
    const { page, pages } = pageOf(requestedPage, betCounts.total);
    const usage = await repos.apiUsage.latest("odds-api");
    return {
        demo: !process.env.DATABASE_URL,
        players,
        betCounts,
        page,
        pages,
        bets: await repos.bets.recent(BETS_PER_PAGE, undefined, (page - 1) * BETS_PER_PAGE),
        credits: usage && { used: usage.used, remaining: usage.remaining },
    };
}
