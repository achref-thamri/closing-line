export const OUTCOMES = ["home", "draw", "away"] as const;
export type Outcome = (typeof OUTCOMES)[number];

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
    if (result.status === "void") return { status: "void", profitOre: 0 };
    if (outcomeOf(result.homeGoals, result.awayGoals) !== bet.selection) {
        return { status: "lost", profitOre: -bet.stakeOre };
    }
    return { status: "won", profitOre: Math.round(bet.stakeOre * (bet.decimalOdds - 1)) };
}
