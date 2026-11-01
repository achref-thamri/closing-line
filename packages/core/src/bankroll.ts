export interface LedgerBet {
    stakeOre: number;
    status: "open" | "won" | "lost" | "void";
    profitOre: number | null;
    settledAt: Date | null;
}

/** Money free to stake: the starting bankroll plus settled profit, minus stakes still riding. */
export function availableBankrollOre(startingOre: number, bets: readonly LedgerBet[]): number {
    return bets.reduce(
        (total, bet) => total + (bet.status === "open" ? -bet.stakeOre : (bet.profitOre ?? 0)),
        startingOre,
    );
}

/** Net loss from bets settled at or after `since`; zero when the period is in profit. */
export function settledLossOre(bets: readonly LedgerBet[], since: Date): number {
    const net = bets
        .filter((bet) => bet.status !== "open" && bet.settledAt !== null && bet.settledAt >= since)
        .reduce((total, bet) => total + (bet.profitOre ?? 0), 0);
    return Math.max(0, -net);
}
