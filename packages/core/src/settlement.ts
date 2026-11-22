export const OUTCOMES = ["home", "draw", "away"] as const;
export type Outcome = (typeof OUTCOMES)[number];

/** Where a bet stands, as stored; the database enum has the same values. */
export type BetStatus = "open" | "won" | "lost" | "void" | "cashed_out";

/** A match-result bet on a tracked fixture settles from the final score; other bets the bettor settles with /open. */
export function settlesFromScore(bet: { fixtureId: string | null; market: string }): boolean {
    return bet.fixtureId !== null && bet.market === "h2h";
}

/** Profit of a bet that ran to the end. Money is in øre so totals add up exactly. */
export function heldProfitOre(bet: { stakeOre: number; lockedOdds: number }, status: "won" | "lost" | "void"): number {
    if (status === "won") return Math.round(bet.stakeOre * (bet.lockedOdds - 1));
    if (status === "lost") return -bet.stakeOre;
    return 0;
}

/** Narrows a stored selection to a 1X2 outcome; the database enforces the same set for `h2h` bets. */
export function isOutcome(value: string): value is Outcome {
    return (OUTCOMES as readonly string[]).includes(value);
}

/** The outcome a stored 1X2 selection names; throws on anything else rather than settling on a guess. */
export function toOutcome(value: string): Outcome {
    if (!isOutcome(value)) throw new RangeError(`Not a 1X2 selection: ${value}`);
    return value;
}

export type MatchResult = { status: "finished"; homeGoals: number; awayGoals: number } | { status: "void" };

export interface Settlement {
    status: "won" | "lost" | "void";
    profitOre: number;
}

export function outcomeOf(homeGoals: number, awayGoals: number): Outcome {
    if (homeGoals > awayGoals) return "home";
    if (homeGoals < awayGoals) return "away";
    return "draw";
}

/** Settles a 1X2 bet. Money is in øre so totals add up exactly. */
export function settle1x2(
    bet: { selection: Outcome; stakeOre: number; decimalOdds: number },
    result: MatchResult,
): Settlement {
    const status =
        result.status === "void"
            ? "void"
            : outcomeOf(result.homeGoals, result.awayGoals) === bet.selection
              ? "won"
              : "lost";
    return { status, profitOre: heldProfitOre({ stakeOre: bet.stakeOre, lockedOdds: bet.decimalOdds }, status) };
}
