/** The spec's go-live rule: what a player needs before real money. */
export const GO_LIVE = { bets: 300, months: 3, maxDrawdown: 0.3 } as const;

/** 1.96 standard errors either side of the mean: a 95% range under a normal approximation. */
const Z95 = 1.96;

/** The mean and its 95% range; no range from a single value. Undefined without values. */
export function meanWithRange(
    values: readonly number[],
): { mean: number; low: number | undefined; high: number | undefined; count: number } | undefined {
    const count = values.length;
    if (count === 0) return undefined;
    const mean = values.reduce((sum, value) => sum + value, 0) / count;
    if (count === 1) return { mean, low: undefined, high: undefined, count };
    const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (count - 1);
    const margin = (Z95 * Math.sqrt(variance)) / Math.sqrt(count);
    return { mean, low: mean - margin, high: mean + margin, count };
}

export interface GoLiveBet {
    status: string;
    stakeOre: number;
    profitOre: number | null;
    clv: number | null;
    createdAt: Date;
    settledAt: Date | null;
}

export interface GoLiveItem {
    key: "bets" | "months" | "clv" | "benchmark" | "drawdown";
    passed: boolean;
}

export interface GoLiveCheck {
    /** Won, lost and cashed-out bets; void ones don't count. */
    settled: number;
    firstBetAt: Date | undefined;
    clv: ReturnType<typeof meanWithRange>;
    roi: number | undefined;
    benchmarkRoi: number | undefined;
    /** Largest fall from a bankroll peak, as a share of the starting bankroll. */
    maxDrawdown: number;
    items: GoLiveItem[];
    /** Every rule above holds. "No unexplained bugs in the last 30 days" is checked by hand. */
    ready: boolean;
}

/**
 * Checks a player's settled bets against the go-live rule: 300 settled bets, three months since the first, positive
 * average CLV, an ROI above the favourite benchmark's, and a drawdown no worse than 30% of the starting bankroll.
 */
export function goLiveCheck(input: {
    bets: readonly GoLiveBet[];
    benchmarkRoi: number | undefined;
    startingBankrollOre: number;
    now: Date;
}): GoLiveCheck {
    const decided = input.bets
        .filter((bet) => bet.status === "won" || bet.status === "lost" || bet.status === "cashed_out")
        .toSorted((a, b) => (a.settledAt?.getTime() ?? 0) - (b.settledAt?.getTime() ?? 0));
    const staked = decided.reduce((sum, bet) => sum + bet.stakeOre, 0);
    const profit = decided.reduce((sum, bet) => sum + (bet.profitOre ?? 0), 0);
    const roi = staked > 0 ? profit / staked : undefined;
    const clv = meanWithRange(decided.flatMap((bet) => (bet.clv === null ? [] : [bet.clv])));

    let bankroll = input.startingBankrollOre;
    let peak = bankroll;
    let maxDrawdown = 0;
    for (const bet of decided) {
        bankroll += bet.profitOre ?? 0;
        peak = Math.max(peak, bankroll);
        maxDrawdown = Math.max(maxDrawdown, (peak - bankroll) / input.startingBankrollOre);
    }

    const firstBetAt = input.bets.reduce<Date | undefined>(
        (first, bet) => (!first || bet.createdAt < first ? bet.createdAt : first),
        undefined,
    );
    const items: GoLiveItem[] = [
        { key: "bets", passed: decided.length >= GO_LIVE.bets },
        { key: "months", passed: firstBetAt !== undefined && addMonths(firstBetAt, GO_LIVE.months) <= input.now },
        { key: "clv", passed: clv !== undefined && clv.mean > 0 },
        {
            key: "benchmark",
            passed: roi !== undefined && (input.benchmarkRoi === undefined || roi > input.benchmarkRoi),
        },
        { key: "drawdown", passed: maxDrawdown <= GO_LIVE.maxDrawdown },
    ];
    return {
        settled: decided.length,
        firstBetAt,
        clv,
        roi,
        benchmarkRoi: input.benchmarkRoi,
        maxDrawdown,
        items,
        ready: items.every((item) => item.passed),
    };
}

function addMonths(date: Date, months: number): Date {
    const next = new Date(date);
    next.setUTCMonth(next.getUTCMonth() + months);
    return next;
}
