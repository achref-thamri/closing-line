import { edge } from "./value.ts";

/** Share of the bankroll the Kelly criterion would stake; zero when the bet has no edge. */
export function kellyFraction(decimalOdds: number, fairProbability: number): number {
    return Math.max(0, edge(decimalOdds, fairProbability) / (decimalOdds - 1));
}

export interface StakeRules {
    /** Share of full Kelly to use, e.g. 0.25 for quarter-Kelly. */
    kellyMultiplier: number;
    /** Largest share of the bankroll on one bet. */
    maxBankrollFraction: number;
    minStake: number;
    maxStake: number;
    /** Stakes are rounded down to a multiple of this. */
    step: number;
}

/** Stake for one bet under fractional Kelly and the caps; zero means skip the bet. */
export function kellyStake(bankroll: number, decimalOdds: number, fairProbability: number, rules: StakeRules): number {
    const fraction = Math.min(
        kellyFraction(decimalOdds, fairProbability) * rules.kellyMultiplier,
        rules.maxBankrollFraction,
    );
    // The tolerance stops float error (0.035 / 1.75 is 0.0199…) from rounding a whole step away.
    const stake = Math.min(Math.floor((bankroll * fraction) / rules.step + 1e-9) * rules.step, rules.maxStake);
    return stake >= rules.minStake ? stake : 0;
}

/** Share of the edge seen that a scanner bet keeps by kickoff on average, and the most it keeps (docs/scanner-rules.md). */
const KEPT_EDGE_SHARE = 0.7;
const MAX_KEPT_EDGE = 0.035;

/**
 * The edge a bet is likely to keep by kickoff. Prices drift back towards Pinnacle's before the close: over four
 * back-tested seasons, 2-5% edges kept about 70% and bigger ones closed at about 3% whatever they started at.
 */
export function keptEdge(seenEdge: number): number {
    return Math.max(0, Math.min(seenEdge * KEPT_EDGE_SHARE, MAX_KEPT_EDGE));
}

/**
 * The live scanner's stake: Kelly under the caps on the edge the bet is likely to keep (`keptEdge`), not the edge
 * seen, so big, noisy edges aren't overbet. A stake Kelly rounds below the minimum is raised to it: every value
 * bet is then placed, and so tipped. Zero only without an edge, or when the minimum would break the bankroll cap.
 * The back-test keeps plain `kellyStake`, so its figures still hold.
 */
export function scannerStake(
    bankroll: number,
    decimalOdds: number,
    fairProbability: number,
    rules: StakeRules,
): number {
    if (kellyFraction(decimalOdds, fairProbability) === 0) return 0;
    const keptProbability = (1 + keptEdge(edge(decimalOdds, fairProbability))) / decimalOdds;
    const stake = kellyStake(bankroll, decimalOdds, keptProbability, rules);
    if (stake > 0) return stake;
    return rules.minStake <= bankroll * rules.maxBankrollFraction ? rules.minStake : 0;
}
