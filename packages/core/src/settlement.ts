export type Outcome = "home" | "draw" | "away";

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
