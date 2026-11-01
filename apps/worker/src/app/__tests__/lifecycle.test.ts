import { createRepositories, openDatabase, type DatabaseHandle, type Repositories } from "@closing-line/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { silentLogger } from "../../lib/logger.ts";
import { markStarted, markStopped, type LifecycleDeps } from "../lifecycle.ts";

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
    await handle.db.execute("truncate worker_state");
    messages = [];
});

function deps(nowIso: string): LifecycleDeps {
    return {
        repos,
        now: () => new Date(nowIso),
        logger: silentLogger,
        notify: (message) => {
            messages.push(message);
            return Promise.resolve();
        },
    };
}

describe("lifecycle", () => {
    it("stays silent on the first start and after a clean shutdown", async () => {
        await markStarted(deps("2026-11-01T10:00:00Z"));
        await markStopped(deps("2026-11-01T11:00:00Z"));
        await markStarted(deps("2026-11-01T11:01:00Z"));
        expect(messages).toEqual([]);
    });

    it("reports a start after a crash, at most once an hour", async () => {
        await markStarted(deps("2026-11-01T10:00:00Z"));
        await markStarted(deps("2026-11-01T10:05:00Z"));
        await markStarted(deps("2026-11-01T10:30:00Z"));
        await markStarted(deps("2026-11-01T11:06:00Z"));
        expect(messages).toHaveLength(2);
        expect(messages[0]).toContain("restarted unexpectedly");
    });

    it("keeps the last alert time across clean restarts", async () => {
        await markStarted(deps("2026-11-01T10:00:00Z"));
        await markStarted(deps("2026-11-01T10:05:00Z"));
        await markStopped(deps("2026-11-01T10:10:00Z"));
        await markStarted(deps("2026-11-01T10:11:00Z"));
        await markStarted(deps("2026-11-01T10:20:00Z"));
        expect(messages).toHaveLength(1);
    });

    it("can record a stop without a start", async () => {
        await markStopped(deps("2026-11-01T10:00:00Z"));
        expect(await repos.state.get("lifecycle")).toEqual({ running: false });
    });
});
