/** Expected profit per unit staked when the true chance is `fairProbability`. */
export function edge(offeredOdds: number, fairProbability: number): number {
    return offeredOdds * fairProbability - 1;
}

/** Closing line value: how much better the locked odds were than the fair closing odds. */
export function closingLineValue(lockedOdds: number, closingFairOdds: number): number {
    return lockedOdds / closingFairOdds - 1;
}

/** A later price for a tip's selection at the tip's bookmaker. */
export interface LaterPrice {
    price: number;
    takenAt: Date;
    /** `closing` for the pre-kickoff poll. */
    kind: string;
}

/** Whether a tip's price was still on offer: at the next poll, and at the pre-kickoff poll; undefined if not seen. */
export interface TipLifetime {
    nextPoll: boolean | undefined;
    atClosing: boolean | undefined;
}

/**
 * How long a tip's price lasted, from the prices stored by later polls: still offered means the same bookmaker paid
 * at least the tip's odds. A tip with no later poll yet has neither answer.
 */
export function tipLifetime(tip: { odds: number; sentAt: Date }, later: readonly LaterPrice[]): TipLifetime {
    const after = later
        .filter((seen) => seen.takenAt > tip.sentAt)
        .toSorted((a, b) => a.takenAt.getTime() - b.takenAt.getTime());
    const kept = (seen: LaterPrice | undefined) => (seen ? seen.price >= tip.odds : undefined);
    return { nextPoll: kept(after[0]), atClosing: kept(after.findLast((seen) => seen.kind === "closing")) };
}
