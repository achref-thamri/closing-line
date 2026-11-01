import { describe, expect, it } from "vitest";
import { dueJobs, localTime, type PlanInput } from "../schedule.ts";

const TZ = "Europe/Copenhagen";
const EPL = "soccer_epl";
// Saturday 7 November 2026; Copenhagen is UTC+1 in winter.
const fixtures = [
    { league: EPL, kickoff: new Date("2026-11-07T12:30:00Z") },
    { league: EPL, kickoff: new Date("2026-11-07T15:00:00Z") },
    { league: EPL, kickoff: new Date("2026-11-07T15:00:00Z") },
    { league: "soccer_spain_la_liga", kickoff: new Date("2026-11-07T15:00:00Z") },
];

/** Due keys at `nowIso`; the hourly settle job is left out except where a test asks for it. */
function plan(nowIso: string, done: string[] = [], withSettle = false): string[] {
    const input: PlanInput = { now: new Date(nowIso), timeZone: TZ, leagues: [EPL], fixtures, done: new Set(done) };
    return dueJobs(input)
        .map((job) => job.key)
        .filter((key) => withSettle || !key.startsWith("settle:"));
}

describe("dueJobs", () => {
    it("syncs fixtures once a day from 06:00 local", () => {
        expect(plan("2026-11-07T04:59:00Z")).toEqual([]);
        expect(plan("2026-11-07T05:00:00Z")).toEqual(["sync:2026-11-07"]);
        expect(plan("2026-11-07T05:01:00Z", ["sync:2026-11-07"])).toEqual([]);
    });

    it("settles once an hour from minute 15", () => {
        expect(plan("2026-11-07T20:14:00Z", ["sync:2026-11-07"], true)).toEqual([]);
        expect(plan("2026-11-07T20:15:00Z", ["sync:2026-11-07"], true)).toEqual(["settle:2026-11-07T21"]);
        expect(plan("2026-11-07T20:45:00Z", ["sync:2026-11-07", "settle:2026-11-07T21"], true)).toEqual([]);
    });

    it("polls on the morning of a match day, for leagues with a match still to come", () => {
        expect(plan("2026-11-07T08:00:00Z", ["sync:2026-11-07"])).toEqual(["morning:soccer_epl:2026-11-07"]);
        expect(plan("2026-11-07T11:00:00Z", ["sync:2026-11-07"])).toEqual([]);
        expect(plan("2026-11-08T08:00:00Z", ["sync:2026-11-08"])).toEqual([]);
    });

    it("polls once per kickoff slot, 35 to 5 minutes before kickoff", () => {
        const done = [
            "sync:2026-11-07",
            "settle:2026-11-07T13",
            "settle:2026-11-07T15",
            "morning:soccer_epl:2026-11-07",
        ];
        expect(plan("2026-11-07T11:54:00Z", done)).toEqual([]);
        expect(plan("2026-11-07T11:55:00Z", done)).toEqual(["prekickoff:soccer_epl:2026-11-07T12:30:00.000Z"]);
        expect(plan("2026-11-07T12:25:00Z", done)).toEqual([]);
        expect(plan("2026-11-07T14:30:00Z", done)).toEqual(["prekickoff:soccer_epl:2026-11-07T15:00:00.000Z"]);
    });

    it("never replays a missed pre-kickoff poll late", () => {
        expect(plan("2026-11-07T12:26:00Z", ["sync:2026-11-07"])).toEqual([]);
    });

    it("reports weekly on Monday from 08:00 local", () => {
        const done = ["sync:2026-11-09"];
        expect(plan("2026-11-09T06:59:00Z", done)).toEqual([]);
        expect(plan("2026-11-09T07:00:00Z", done)).toEqual(["weekly:2026-11-09"]);
        expect(plan("2026-11-10T07:00:00Z", ["sync:2026-11-10"])).toEqual([]);
    });

    it("leaves out leagues that are not configured", () => {
        const keys = plan("2026-11-07T14:30:00Z", ["sync:2026-11-07"]);
        expect(keys.some((key) => key.includes("la_liga"))).toBe(false);
    });
});

describe("localTime", () => {
    it("follows daylight saving time", () => {
        expect(localTime(new Date("2026-07-01T22:30:00Z"), TZ)).toEqual({
            date: "2026-07-02",
            weekday: 4,
            hour: 0,
            minute: 30,
        });
        expect(localTime(new Date("2026-12-31T23:30:00Z"), TZ)).toEqual({
            date: "2027-01-01",
            weekday: 5,
            hour: 0,
            minute: 30,
        });
    });
});
