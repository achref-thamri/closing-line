import { parseConfig } from "@closing-line/config";
import { createRepositories, openDatabase, type DatabaseHandle, type Repositories } from "@closing-line/db";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { syncFixtures } from "../syncFixtures.ts";

const config = parseConfig({
    ODDS_API_KEY: "k",
    FOOTBALL_DATA_TOKEN: "t",
    TELEGRAM_BOT_TOKEN: "1:a",
    TELEGRAM_OWNER_CHAT_ID: "1",
});

let handle: DatabaseHandle;
let repos: Repositories;

beforeAll(async () => {
    handle = await openDatabase({ kind: "pglite" });
    repos = createRepositories(handle.db);
});

afterAll(async () => {
    await handle.close();
});

describe("syncFixtures", () => {
    it("stores fixtures for every league and records the free balance", async () => {
        const balance = { used: 1, remaining: 499, lastCost: 1, takenAt: new Date("2026-11-08T12:00:00Z") };
        const record = vi.fn(() => Promise.resolve());
        const info = {
            id: "a".repeat(32),
            league: "soccer_epl",
            homeTeam: "Liverpool",
            awayTeam: "Arsenal",
            kickoff: new Date("2026-11-08T13:00:00Z"),
        };
        const count = await syncFixtures({
            source: { events: () => Promise.resolve({ data: [info], balance }) },
            guard: { record },
            repos,
            config,
        });
        // The fake source returns the same event for each of the eight default leagues.
        expect(count).toBe(8);
        expect(record).toHaveBeenCalledWith(balance);
        expect(await repos.fixtures.get(info.id)).toBeDefined();
    });
});
