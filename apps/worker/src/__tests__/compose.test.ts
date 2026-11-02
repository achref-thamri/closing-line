import { readFileSync } from "node:fs";
import { parseConfig } from "@closing-line/config";
import { createRepositories, openDatabase, type DatabaseHandle } from "@closing-line/db";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { compose } from "../compose.ts";
import { silentLogger } from "../lib/logger.ts";

const config = parseConfig({
    ODDS_API_KEY: "k",
    FOOTBALL_DATA_TOKEN: "t",
    TELEGRAM_BOT_TOKEN: "1:a",
    TELEGRAM_OWNER_CHAT_ID: "1",
});
const recording = (name: string) =>
    readFileSync(new URL(`../adapters/oddsApi/__tests__/recordings/${name}`, import.meta.url), "utf8");
const credits = { "x-requests-used": "1", "x-requests-remaining": "499", "x-requests-last": "1" };

let handle: DatabaseHandle;

beforeAll(async () => {
    handle = await openDatabase({ kind: "pglite" });
});

afterAll(async () => {
    await handle.close();
});

beforeEach(async () => {
    await handle.db.execute(
        "truncate players, fixtures, odds_snapshots, bets, passes, api_usage, job_runs, worker_state restart identity cascade",
    );
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe("compose", () => {
    it("wires the jobs to the adapters and use cases", async () => {
        vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
            const url = (input as URL | string).toString();
            const body = url.includes("/events")
                ? recording("events.json")
                : url.includes("/odds")
                  ? recording("odds-h2h.json")
                  : "[]";
            return Promise.resolve(new Response(body, { headers: { "content-type": "application/json", ...credits } }));
        });
        const now = () => new Date("2026-11-01T09:00:00Z");
        const runner = compose({ config, db: handle.db, logger: silentLogger, notify: () => Promise.resolve(), now });
        expect(runner.leagues).toEqual([
            "soccer_epl",
            "soccer_efl_champ",
            "soccer_germany_bundesliga",
            "soccer_spain_la_liga",
            "soccer_italy_serie_a",
            "soccer_france_ligue_one",
        ]);

        expect(await runner.handlers.sync({ key: "sync", kind: "sync" })).toEqual({
            status: "succeeded",
            // The recording answers for each of the six default leagues.
            message: "18 fixtures",
        });
        const poll = await runner.handlers.morning_poll({ key: "m", kind: "morning_poll", league: "soccer_epl" });
        expect(poll).toEqual({
            status: "succeeded",
            message: "2 events, 0 value bets, 0 favourite bets, 0 closing prices",
        });
        expect(await runner.handlers.settle({ key: "s", kind: "settle" })).toEqual({
            status: "succeeded",
            message: "0 fixtures, 0 bets settled",
        });
        await expect(runner.handlers.prekickoff_poll({ key: "p", kind: "prekickoff_poll" })).rejects.toThrow(
            "poll job without a league",
        );
    });

    it("sends the weekly report to the owner and every human", async () => {
        const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}"));
        const db = createRepositories(handle.db);
        await db.players.ensure([
            {
                id: "tg_2",
                name: "Sam",
                kind: "human",
                startingBankrollOre: 6_000_000,
                telegramChatId: "2",
                tipsMuted: true,
            },
        ]);
        const runner = compose({ config, db: handle.db, logger: silentLogger, notify: () => Promise.resolve() });
        expect(await runner.handlers.weekly_report({ key: "w", kind: "weekly_report" })).toEqual({
            status: "succeeded",
        });
        const chats = fetch.mock.calls.map(
            ([, init]) => (JSON.parse(init?.body as string) as { chat_id: number }).chat_id,
        );
        expect(chats.sort()).toEqual([1, 2]);
    });

    it("reports a poll the credit guard refused as skipped", async () => {
        vi.spyOn(globalThis, "fetch").mockResolvedValue(
            new Response("[]", {
                headers: { "x-requests-used": "500", "x-requests-remaining": "0", "x-requests-last": "0" },
            }),
        );
        const runner = compose({ config, db: handle.db, logger: silentLogger, notify: () => Promise.resolve() });
        expect(
            await runner.handlers.prekickoff_poll({ key: "p", kind: "prekickoff_poll", league: "soccer_epl" }),
        ).toEqual({
            status: "skipped",
            message: "would dip into the 50-credit reserve",
        });
    });
});
