import { OUTCOMES, type Outcome } from "./settlement.ts";

/** One forecast: the probability given to an outcome, and whether it happened. */
export interface Forecast {
    probability: number;
    happened: boolean;
}

/** A band of forecasts, e.g. 40–60%: how likely they were on average and how often they happened. */
export interface CalibrationBand {
    from: number;
    to: number;
    count: number;
    averageProbability: number;
    observedRate: number;
}

/**
 * Groups forecasts into bands `width` wide (0.2 gives 0–20%, 20–40%, …) and keeps the bands with at least
 * `minCount` forecasts. A well-calibrated source has each band's observed rate close to its average probability.
 */
export function calibration(forecasts: readonly Forecast[], width: number, minCount: number): CalibrationBand[] {
    const bands = new Map<number, Forecast[]>();
    for (const forecast of forecasts) {
        // A probability of exactly 1 belongs to the top band, not a band of its own.
        const index = Math.min(Math.floor(forecast.probability / width), Math.ceil(1 / width) - 1);
        bands.set(index, [...(bands.get(index) ?? []), forecast]);
    }
    return [...bands.entries()]
        .filter(([, members]) => members.length >= minCount)
        .sort(([a], [b]) => a - b)
        .map(([index, members]) => ({
            from: index * width,
            to: Math.min(1, (index + 1) * width),
            count: members.length,
            averageProbability: members.reduce((sum, member) => sum + member.probability, 0) / members.length,
            observedRate: members.filter((member) => member.happened).length / members.length,
        }));
}

/** A match's fair home, draw and away probabilities, and how it ended. */
export interface MatchForecast {
    probabilities: Record<Outcome, number>;
    result: Outcome;
}

/** Keeps the log of a zero probability finite. */
const MIN_PROBABILITY = 1e-15;

/**
 * Log loss (minus the log of the probability given to the result) and Brier score (squared error summed over the
 * three outcomes), each averaged over the matches. Lower is better for both. The log loss is the same measure as
 * ADR 0011's, so the two can be compared.
 */
export function forecastScores(matches: readonly MatchForecast[]): { logLoss: number; brier: number } | undefined {
    if (matches.length === 0) return undefined;
    let logLoss = 0;
    let brier = 0;
    for (const { probabilities, result } of matches) {
        logLoss -= Math.log(Math.max(probabilities[result], MIN_PROBABILITY));
        for (const outcome of OUTCOMES) {
            brier += (probabilities[outcome] - (outcome === result ? 1 : 0)) ** 2;
        }
    }
    return { logLoss: logLoss / matches.length, brier: brier / matches.length };
}
