import {
    bankrollSeries,
    goLiveCheck,
    meetsScannerRules,
    playerStats,
    statsFromTotals,
    totalsOf,
    type BankrollPoint,
    type GoLiveCheck,
    type PlayerStats,
    type ScannerRuleBet,
} from "@closing-line/core";
import {
    createRepositories,
    openDatabase,
    type BetWithFixture,
    type DatabaseHandle,
    type Player,
} from "@closing-line/db";
import { seedDemo } from "./demo.ts";
import { SCANNER_RULES } from "./rules.ts";

export interface PlayerSummary {
    player: Player;
    stats: PlayerStats;
    bankrollOre: number;
    /** Profit as a share of the starting bankroll, so players who start with different bankrolls compare fairly. */
    growth: number;
    series: BankrollPoint[];
    /** The scanner only: its results over the settled bets today's rules would still place. */
    currentRules?: PlayerStats;
}

/** Bets with a closing price a player needs before the leaderboard ranks them: fewer says more about luck than skill. */
export const MIN_CLV_BETS_TO_RANK = 30;

type Rankable = Pick<PlayerSummary, "growth"> & { stats: Pick<PlayerStats, "averageClv" | "clvCount"> };

export function isRanked(summary: Rankable): boolean {
    return summary.stats.averageClv !== undefined && summary.stats.clvCount >= MIN_CLV_BETS_TO_RANK;
}

/**
 * Best average CLV first among players with enough closing prices; the rest after them, closest to ranking first,
 * then by growth. CLV, not profit, is what the project judges players on.
 */
export function byClv(a: Rankable, b: Rankable): number {
    const ranked = Number(isRanked(b)) - Number(isRanked(a));
    if (ranked !== 0) return ranked;
    if (isRanked(a)) return (b.stats.averageClv ?? 0) - (a.stats.averageClv ?? 0);
    return b.stats.clvCount - a.stats.clvCount || b.growth - a.growth;
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
    /** The player the table is filtered to, when the id names one. */
    player: string | undefined;
    bets: BetWithFixture[];
    credits: { used: number; remaining: number } | undefined;
    /** The scanner against the go-live rule, counting only bets today's rules would place. */
    goLive: GoLiveCheck | undefined;
    /** Running average CLV per automated player, one point per settled bet with a closing price. */
    clvSeries: { playerId: string; points: { t: number; value: number }[] }[];
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

export async function loadDashboard(requestedPage?: string, requestedPlayer?: string): Promise<Dashboard> {
    const repos = createRepositories((await database()).db);
    const totals = await repos.bets.totals();
    const list = await repos.players.list();
    // Settled bets for the CLV chart and the go-live check; the scanner's only under today's rules.
    const settledByPlayer = new Map(
        await Promise.all(
            list
                .filter((player) => player.kind !== "bettor")
                .map(async (player) => {
                    const settled = await repos.bets.settledWithFixture(player.id);
                    const counted =
                        player.kind === "scanner" ? settled.filter((bet) => underTodaysRules(bet)) : settled;
                    return [player.id, counted] as const;
                }),
        ),
    );
    const players = await Promise.all(
        list.map(async (player) => {
            const stats = statsFromTotals(totals.get(player.id) ?? totalsOf([]));
            const ledger = await repos.bets.settledLedger(player.id);
            return {
                player,
                stats,
                bankrollOre: player.startingBankrollOre + stats.profitOre,
                growth: stats.profitOre / player.startingBankrollOre,
                series: bankrollSeries(player.startingBankrollOre, player.createdAt, ledger),
                ...(player.kind === "scanner" && {
                    currentRules: playerStats(settledByPlayer.get(player.id) ?? []),
                }),
            };
        }),
    );
    players.sort(byClv);
    const scanner = players.find((summary) => summary.player.kind === "scanner");
    const benchmark = players.find((summary) => summary.player.kind === "benchmark");
    const goLive =
        scanner &&
        goLiveCheck({
            bets: settledByPlayer.get(scanner.player.id) ?? [],
            benchmarkRoi: benchmark?.stats.roi,
            startingBankrollOre: scanner.player.startingBankrollOre,
            now: new Date(),
        });
    const clvSeries = [...settledByPlayer].map(([playerId, bets]) => ({ playerId, points: runningClv(bets) }));
    const player = players.find((summary) => summary.player.id === requestedPlayer)?.player.id;
    const betCounts = { total: 0, open: 0, settled: 0 };
    for (const {
        player: { id },
        stats,
    } of players) {
        if (player && id !== player) continue;
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
        player,
        bets: await repos.bets.listing(BETS_PER_PAGE, player, (page - 1) * BETS_PER_PAGE),
        credits: usage && { used: usage.used, remaining: usage.remaining },
        goLive,
        clvSeries,
    };
}

function underTodaysRules(bet: ScannerRuleBet & { kickoff: Date }): boolean {
    return meetsScannerRules(bet, bet.kickoff, SCANNER_RULES);
}

/** The average CLV so far after each settled bet that has one, in settling order. */
export function runningClv(
    bets: readonly { clv: number | null; settledAt: Date | null }[],
): { t: number; value: number }[] {
    let sum = 0;
    let count = 0;
    return bets.flatMap((bet) => {
        if (bet.clv === null || !bet.settledAt) return [];
        sum += bet.clv;
        count++;
        return [{ t: bet.settledAt.getTime(), value: sum / count }];
    });
}
