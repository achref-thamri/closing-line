import type { LedgerBet } from "./bankroll.ts";

export interface MetricsBet extends LedgerBet {
    clv: number | null;
}

export interface PlayerStats {
    /** Won and lost bets; void bets are counted separately and leave ROI alone. */
    settled: number;
    won: number;
    void: number;
    open: number;
    stakedOre: number;
    profitOre: number;
    /** Profit per unit staked on settled bets; undefined before the first one. */
    roi: number | undefined;
    /** Average closing line value over bets that have one; undefined before the first one. */
    averageClv: number | undefined;
}

/** Results for a set of bets: counts, money, ROI and average CLV. */
export function playerStats(bets: readonly MetricsBet[]): PlayerStats {
    const decided = bets.filter((bet) => bet.status === "won" || bet.status === "lost");
    const stakedOre = decided.reduce((total, bet) => total + bet.stakeOre, 0);
    const profitOre = decided.reduce((total, bet) => total + (bet.profitOre ?? 0), 0);
    const clvs = bets.flatMap((bet) => (bet.clv === null ? [] : [bet.clv]));
    return {
        settled: decided.length,
        won: decided.filter((bet) => bet.status === "won").length,
        void: bets.filter((bet) => bet.status === "void").length,
        open: bets.filter((bet) => bet.status === "open").length,
        stakedOre,
        profitOre,
        roi: stakedOre > 0 ? profitOre / stakedOre : undefined,
        averageClv: clvs.length > 0 ? clvs.reduce((total, clv) => total + clv, 0) / clvs.length : undefined,
    };
}
