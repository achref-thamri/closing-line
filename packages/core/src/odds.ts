/** Probability implied by decimal odds, bookmaker margin included. */
export function impliedProbability(decimalOdds: number): number {
    if (!Number.isFinite(decimalOdds) || decimalOdds <= 1) {
        throw new RangeError(`Decimal odds must be a finite number above 1, got ${decimalOdds}`);
    }
    return 1 / decimalOdds;
}
