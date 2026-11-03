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
