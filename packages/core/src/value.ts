/** Expected profit per unit staked when the true chance is `fairProbability`. */
export function edge(offeredOdds: number, fairProbability: number): number {
    return offeredOdds * fairProbability - 1;
}

/** Closing line value: how much better the locked odds were than the fair closing odds. */
export function closingLineValue(lockedOdds: number, closingFairOdds: number): number {
    return lockedOdds / closingFairOdds - 1;
}
