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
