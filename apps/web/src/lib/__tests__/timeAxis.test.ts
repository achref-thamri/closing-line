import { describe, expect, it } from "vitest";
import { timeAxis } from "../timeAxis.ts";

const TZ = "Europe/Copenhagen";
const at = (iso: string) => new Date(iso).getTime();

describe("timeAxis", () => {
    it("labels a span of under two days by hour, on round local times, each label once", () => {
        // The live chart on 3 Nov 2026: first settled bet 1 Nov 19:30, latest 2 Nov 23:00 (Copenhagen).
        const axis = timeAxis(at("2026-11-01T18:30:00Z"), at("2026-11-02T22:00:00Z"), TZ);
        const labels = axis.ticks.map(axis.label);
        expect(labels).toEqual(["2 Nov, 00:00", "2 Nov, 06:00", "2 Nov, 12:00", "2 Nov, 18:00"]);
        expect(new Set(labels).size).toBe(labels.length);
    });

    it("labels longer spans by day, at local midnight", () => {
        const axis = timeAxis(at("2026-11-01T12:00:00Z"), at("2026-11-09T12:00:00Z"), TZ);
        expect(axis.ticks.map(axis.label)).toEqual(["3 Nov", "5 Nov", "7 Nov", "9 Nov"]);
        expect(axis.ticks.every((t) => new Date(t).getUTCHours() === 23)).toBe(true);
    });

    it("keeps to the tick limit over months, and gives no ticks for a single point", () => {
        const axis = timeAxis(at("2026-11-01T00:00:00Z"), at("2027-03-01T00:00:00Z"), TZ);
        expect(axis.ticks.length).toBeLessThanOrEqual(7);
        expect(timeAxis(at("2026-11-01T00:00:00Z"), at("2026-11-01T00:00:00Z"), TZ).ticks).toEqual([]);
    });
});
