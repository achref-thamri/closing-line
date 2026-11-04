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
    const stake = Math.min(Math.floor((bankroll * fraction) / rules.step) * rules.step, rules.maxStake);
    return stake >= rules.minStake ? stake : 0;
}

/**
 * The live scanner's stake. Kelly under the caps, except that a stake Kelly rounds below the minimum is raised to
 * it: every value bet is then placed, and so tipped. Zero only without an edge, or when the minimum would break the
 * bankroll cap. The back-test keeps plain `kellyStake`, so ADR 0008's figures still hold.
 */
export function scannerStake(
    bankroll: number,
    decimalOdds: number,
    fairProbability: number,
    rules: StakeRules,
): number {
    const stake = kellyStake(bankroll, decimalOdds, fairProbability, rules);
    if (stake > 0 || kellyFraction(decimalOdds, fairProbability) === 0) return stake;
    return rules.minStake <= bankroll * rules.maxBankrollFraction ? rules.minStake : 0;
}
