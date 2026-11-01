/** The fields of a bet that results depend on. */
export interface MetricsBet {
    stakeOre: number;
    status: "open" | "won" | "lost" | "void";
    profitOre: number | null;
    settledAt: Date | null;
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

/** Sums over a player's bets, as the database computes them in one query (`bets.totals`). */
export interface PlayerTotals {
    settled: number;
    won: number;
    void: number;
    open: number;
    /** Stakes of won and lost bets. */
    stakedOre: number;
    /** Profit of won, lost and void bets (void is zero). */
    profitOre: number;
    /** Stakes still riding on open bets. */
    openStakeOre: number;
    clvSum: number;
    clvCount: number;
}

/** ROI and average CLV from totals; the one place these rates are defined. */
export function statsFromTotals(totals: PlayerTotals): PlayerStats {
    return {
        settled: totals.settled,
        won: totals.won,
        void: totals.void,
        open: totals.open,
        stakedOre: totals.stakedOre,
        profitOre: totals.profitOre,
        roi: totals.stakedOre > 0 ? totals.profitOre / totals.stakedOre : undefined,
        averageClv: totals.clvCount > 0 ? totals.clvSum / totals.clvCount : undefined,
    };
}

/** Totals for bets held in memory, matching what `bets.totals` computes in SQL. */
export function totalsOf(bets: readonly MetricsBet[]): PlayerTotals {
    const decided = bets.filter((bet) => bet.status === "won" || bet.status === "lost");
    const open = bets.filter((bet) => bet.status === "open");
    const clvs = bets.flatMap((bet) => (bet.clv === null ? [] : [bet.clv]));
    return {
        settled: decided.length,
        won: decided.filter((bet) => bet.status === "won").length,
        void: bets.filter((bet) => bet.status === "void").length,
        open: open.length,
        stakedOre: decided.reduce((total, bet) => total + bet.stakeOre, 0),
        profitOre: decided.reduce((total, bet) => total + (bet.profitOre ?? 0), 0),
        openStakeOre: open.reduce((total, bet) => total + bet.stakeOre, 0),
        clvSum: clvs.reduce((total, clv) => total + clv, 0),
        clvCount: clvs.length,
    };
}

/** Results for a set of bets: counts, money, ROI and average CLV. */
export function playerStats(bets: readonly MetricsBet[]): PlayerStats {
    return statsFromTotals(totalsOf(bets));
}

/** Money free to stake: the starting bankroll plus settled profit, minus stakes still riding. */
export function availableFromTotals(
    startingOre: number,
    totals: Pick<PlayerTotals, "profitOre" | "openStakeOre">,
): number {
    return startingOre + totals.profitOre - totals.openStakeOre;
}

export interface BankrollPoint {
    at: Date;
    bankrollOre: number;
}

/** Bankroll after each settled bet, in settlement order, from `startingOre` at `start` (or the first settlement). */
export function bankrollSeries(startingOre: number, start: Date, bets: readonly MetricsBet[]): BankrollPoint[] {
    const settled = bets
        .filter((bet): bet is MetricsBet & { settledAt: Date } => bet.status !== "open" && bet.settledAt !== null)
        .sort((a, b) => a.settledAt.getTime() - b.settledAt.getTime());
    const first = settled[0]?.settledAt;
    const points: BankrollPoint[] = [{ at: first && first < start ? first : start, bankrollOre: startingOre }];
    let bankrollOre = startingOre;
    for (const bet of settled) {
        bankrollOre += bet.profitOre ?? 0;
        points.push({ at: bet.settledAt, bankrollOre });
    }
    return points;
}
