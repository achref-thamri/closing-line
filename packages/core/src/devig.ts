import { impliedProbability } from "./odds.ts";

const MAX_ITERATIONS = 200;
const TOLERANCE = 1e-12;

/**
 * Fair probabilities with the margin spread in proportion to each implied probability.
 * Simple, but it overstates longshots, which carry more of the margin in practice.
 */
export function devigProportional(decimalOdds: readonly number[]): number[] {
    const implied = decimalOdds.map(impliedProbability);
    const total = implied.reduce((sum, probability) => sum + probability, 0);
    return implied.map((probability) => probability / total);
}

/**
 * Fair probabilities by the power method: find k so that the implied probabilities raised to k sum to one.
 * Longshots lose relatively more margin than favourites, which matches how bookmakers price.
 */
export function devigPower(decimalOdds: readonly number[]): number[] {
    if (decimalOdds.length < 2) throw new RangeError("A market needs at least two outcomes");
    const implied = decimalOdds.map(impliedProbability);
    const sumAt = (k: number) => implied.reduce((sum, probability) => sum + probability ** k, 0);

    // The sum falls from n at k = 0 towards zero, so one root exists. Widen the bracket until it holds it.
    let low = 0;
    let high = 1;
    while (sumAt(high) > 1) high *= 2;

    for (let i = 0; i < MAX_ITERATIONS && high - low > TOLERANCE; i++) {
        const middle = (low + high) / 2;
        if (sumAt(middle) > 1) low = middle;
        else high = middle;
    }
    const k = (low + high) / 2;
    const fair = implied.map((probability) => probability ** k);
    const total = fair.reduce((sum, probability) => sum + probability, 0);
    return fair.map((probability) => probability / total);
}
