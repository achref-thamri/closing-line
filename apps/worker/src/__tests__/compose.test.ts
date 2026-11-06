import { readFileSync } from "node:fs";
import { parseConfig } from "@closing-line/config";
import { createRepositories, openDatabase, type DatabaseHandle } from "@closing-line/db";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { compose, type Worker } from "../compose.ts";
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
        "truncate players, fixtures, odds_snapshots, bets, api_usage, job_runs, worker_state, chat_sessions restart identity cascade",
    );
});

afterEach(() => {
    vi.restoreAllMocks();
});

/** Composes the worker with Telegram answered locally; returns the chats each message went to. */
const botInfo = {
    id: 9,
    is_bot: true,
    first_name: "Closing Line",
    username: "closing_line_test_bot",
    can_join_groups: false,
    can_read_all_group_messages: false,
    supports_inline_queries: false,
    can_connect_to_business: false,
    has_main_web_app: false,
    has_topics_enabled: false,
    allows_users_to_create_topics: false,
    can_manage_bots: false,
    supports_join_request_queries: false,
} as const;

function composeOffline(now?: () => Date): { worker: Worker; chats: number[] } {
    const worker = compose({ config, db: handle.db, logger: silentLogger, botInfo, ...(now ? { now } : {}) });
    const chats: number[] = [];
    worker.bot.api.config.use((_prev, method, payload) => {
        if (method === "sendMessage") chats.push((payload as { chat_id: number }).chat_id);
        return Promise.resolve({ ok: true, result: true } as never);
    });
    return { worker, chats };
}

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
        const { runner } = composeOffline(now).worker;
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

    it("sends the weekly report to the owner and every bettor", async () => {
        vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}"));
        const db = createRepositories(handle.db);
        await db.players.ensure([
            {
                id: "tg_2",
                name: "Sam",
                kind: "bettor",
                startingBankrollOre: 6_000_000,
                telegramChatId: "2",
                tipsMuted: true,
            },
        ]);
        const { worker, chats } = composeOffline();
        expect(await worker.runner.handlers.weekly_report({ key: "w", kind: "weekly_report" })).toEqual({
            status: "succeeded",
        });
        expect(chats.sort()).toEqual([1, 2]);
    });

    it("shares one /picks refresh between bettors asking at once, and skips leagues polled in the last 12 hours", async () => {
        // The first odds request waits until both /picks have arrived, so the two really overlap.
        let release: () => void = () => undefined;
        const gate = new Promise<void>((resolve) => (release = resolve));
        const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
            await gate;
            return new Response(recording("odds-h2h.json"), {
                headers: { "content-type": "application/json", ...credits },
            });
        });
        let clock = new Date("2026-11-01T09:00:00Z");
        const { worker, chats } = composeOffline(() => clock);
        const picks = (updateId: number) =>
            worker.bot.handleUpdate({
                update_id: updateId,
                message: {
                    message_id: updateId,
                    date: 0,
                    chat: { id: 1, type: "private", first_name: "Owner" },
                    from: { id: 1, is_bot: false, first_name: "Owner" },
                    text: "/picks",
                    entities: [{ type: "bot_command", offset: 0, length: 6 }],
                },
            });
        const oddsCalls = (league = "") =>
            fetch.mock.calls.filter(([input]) => (input as URL | string).toString().includes(`${league}/odds`)).length;

        const first = picks(1);
        await vi.waitFor(() => {
            expect(fetch).toHaveBeenCalled();
        });
        const second = picks(2);
        release();
        await Promise.all([first, second]);
        expect(oddsCalls()).toBe(config.leagues.length);
        expect(chats).toEqual([1, 1]);

        // The recording only has Premier League matches, so only that league has fresh odds an hour later.
        clock = new Date(clock.getTime() + 3_600_000);
        await picks(3);
        expect(oddsCalls("soccer_epl")).toBe(1);
        expect(oddsCalls()).toBe(2 * config.leagues.length - 1);
    });

    it("runs the reminder job", async () => {
        vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}"));
        const { runner } = composeOffline().worker;
        expect(await runner.handlers.remind({ key: "r", kind: "remind" })).toEqual({
            status: "succeeded",
            message: "0 reminded",
        });
    });

    it("reports a poll the credit guard refused as skipped", async () => {
        vi.spyOn(globalThis, "fetch").mockResolvedValue(
            new Response("[]", {
                headers: { "x-requests-used": "500", "x-requests-remaining": "0", "x-requests-last": "0" },
            }),
        );
        const { runner } = composeOffline().worker;
        expect(
            await runner.handlers.prekickoff_poll({ key: "p", kind: "prekickoff_poll", league: "soccer_epl" }),
        ).toEqual({
            status: "skipped",
            message: "would dip into the 50-credit reserve",
        });
    });
});
