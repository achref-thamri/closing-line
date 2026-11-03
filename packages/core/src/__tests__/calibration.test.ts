import { describe, expect, it } from "vitest";
import { calibration } from "../calibration.ts";

describe("calibration", () => {
    const forecasts = (probability: number, count: number, happened: number) =>
        Array.from({ length: count }, (_, i) => ({ probability, happened: i < happened }));

    it("groups forecasts into bands and compares the average probability with what happened", () => {
        const bands = calibration(
            [...forecasts(0.5, 10, 6), ...forecasts(0.3, 10, 2), ...forecasts(0.9, 3, 3)],
            0.2,
            5,
        );
        expect(bands).toHaveLength(2);
        expect(bands[0]).toMatchObject({ count: 10, observedRate: 0.2 });
        expect(bands[0]?.from).toBeCloseTo(0.2);
        expect(bands[0]?.averageProbability).toBeCloseTo(0.3);
        expect(bands[1]).toMatchObject({ count: 10, observedRate: 0.6 });
        expect(bands[1]?.to).toBeCloseTo(0.6);
    });

    it("puts a probability of exactly 1 in the top band", () => {
        const [band] = calibration(forecasts(1, 5, 5), 0.2, 1);
        expect(band?.from).toBeCloseTo(0.8);
        expect(band?.to).toBe(1);
    });
});
