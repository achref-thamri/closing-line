import { createRepositories, openDatabase, type DatabaseHandle, type Repositories } from "@closing-line/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { silentLogger } from "../../lib/logger.ts";
import { tick, type JobHandlers, type RunnerDeps } from "../runner.ts";

let handle: DatabaseHandle;
let repos: Repositories;
let messages: string[];

beforeAll(async () => {
    handle = await openDatabase({ kind: "pglite" });
    repos = createRepositories(handle.db);
});

afterAll(async () => {
    await handle.close();
});

beforeEach(async () => {
    await handle.db.execute("truncate fixtures, job_runs cascade");
    messages = [];
});

function deps(nowIso: string, handlers: Partial<JobHandlers>): RunnerDeps {
    const ok = () => Promise.resolve({ status: "succeeded" as const });
    return {
        repos,
        leagues: ["soccer_epl"],
        timeZone: "Europe/Copenhagen",
        handlers: {
            sync: ok,
            settle: ok,
            morning_poll: ok,
            prekickoff_poll: ok,
            weekly_report: ok,
            remind: ok,
            ...handlers,
        },
        now: () => new Date(nowIso),
        logger: silentLogger,
        notify: (message) => {
            messages.push(message);
            return Promise.resolve();
        },
    };
}

describe("tick", () => {
    it("runs each due job once, across ticks", async () => {
        const sync = vi.fn(() => Promise.resolve({ status: "succeeded" as const, message: "13 fixtures" }));
        await tick(deps("2026-11-07T05:20:00Z", { sync }));
        await tick(deps("2026-11-07T05:21:00Z", { sync }));
        expect(sync).toHaveBeenCalledOnce();
        const runs = await repos.runs.recent(5);
        expect(runs.map((run) => [run.key, run.status, run.message])).toEqual(
            expect.arrayContaining([["sync:2026-11-07", "succeeded", "13 fixtures"]]),
        );
    });

    it("plans polls from stored fixtures", async () => {
        await repos.fixtures.upsert([
            {
                id: "a".repeat(32),
                league: "soccer_epl",
                homeTeam: "A",
                awayTeam: "B",
                kickoff: new Date("2026-11-07T15:00:00Z"),
            },
        ]);
        const prekickoff = vi.fn(() =>
            Promise.resolve({ status: "skipped" as const, message: "daily allowance used" }),
        );
        await tick(deps("2026-11-07T14:50:00Z", { prekickoff_poll: prekickoff }));
        expect(prekickoff).toHaveBeenCalledWith({
            key: "prekickoff:soccer_epl:2026-11-07T15:00:00.000Z",
            kind: "prekickoff_poll",
            league: "soccer_epl",
        });
    });

    it("records and reports a failed job, then carries on", async () => {
        const sync = vi.fn(() => Promise.reject(new Error("Odds API events: server error 503")));
        const settle = vi.fn(() => Promise.resolve({ status: "succeeded" as const }));
        await tick(deps("2026-11-07T05:20:00Z", { sync, settle }));
        expect(settle).toHaveBeenCalledOnce();
        expect(messages).toEqual(["❌ Job sync:2026-11-07 failed: Odds API events: server error 503"]);
        expect((await repos.runs.recent(5)).find((run) => run.job === "sync")).toMatchObject({ status: "failed" });

        await tick(deps("2026-11-07T05:21:00Z", { sync, settle }));
        expect(sync).toHaveBeenCalledOnce();
    });
});
