import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BetFlow, Reply } from "../../../app/betFlow.ts";
import { silentLogger } from "../../../lib/logger.ts";
import { createBetBot, screenshotStore } from "../bot.ts";

const botInfo = {
    id: 1,
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
const chat = { id: 200, type: "private", first_name: "Sam" } as const;
const from = { id: 200, is_bot: false, first_name: "Sam" } as const;

let calls: { method: string; payload: Record<string, unknown> }[];

function setup(flow: Partial<BetFlow>, fileFetch = vi.fn().mockResolvedValue(new Response("jpeg bytes"))) {
    const bot = createBetBot({ botToken: "1:secret", logger: silentLogger, botInfo, fetch: fileFetch });
    bot.api.config.use((_prev, method, payload) => {
        calls.push({ method, payload: payload });
        const result = method === "getFile" ? { file_id: "f", file_unique_id: "u", file_path: "photos/1.jpg" } : true;
        return Promise.resolve({ ok: true, result } as never);
    });
    bot.attach(flow as BetFlow);
    return { bot, fileFetch };
}

function message(extra: Record<string, unknown>, updateId = 1) {
    return { update_id: updateId, message: { message_id: 10, date: 0, chat, from, ...extra } };
}

const sent = (method: string) => calls.filter((call) => call.method === method).map((call) => call.payload);

beforeEach(() => {
    calls = [];
});

describe("bet bot", () => {
    it("answers /start with the flow's reply", async () => {
        const start = vi.fn().mockResolvedValue({ text: "Welcome" });
        const { bot } = setup({ start });
        await bot.handleUpdate(message({ text: "/start", entities: [{ type: "bot_command", offset: 0, length: 6 }] }));
        expect(start).toHaveBeenCalledWith(200, "Sam");
        expect(sent("sendMessage")).toEqual([expect.objectContaining({ chat_id: 200, text: "Welcome" })]);
    });

    it("downloads the largest photo and sends one card per bet with its buttons", async () => {
        const cards: Reply[] = [
            { text: "card 1", keyboard: [[{ text: "⚡ Lineup", data: "t:abc:l" }]] },
            { text: "settled" },
        ];
        const slip = vi.fn().mockResolvedValue(cards);
        const { bot, fileFetch } = setup({ slip });
        await bot.handleUpdate(
            message({
                photo: [
                    { file_id: "small", file_unique_id: "s", width: 90, height: 160 },
                    { file_id: "large", file_unique_id: "l", width: 1080, height: 1920 },
                ],
            }),
        );
        expect(sent("getFile")).toEqual([{ file_id: "large" }]);
        expect(fileFetch).toHaveBeenCalledWith(
            "https://api.telegram.org/file/bot1:secret/photos/1.jpg",
            expect.anything(),
        );
        expect(slip).toHaveBeenCalledWith(200, { data: Buffer.from("jpeg bytes"), mediaType: "image/jpeg" });
        expect(sent("sendMessage")).toEqual([
            expect.objectContaining({
                text: "card 1",
                reply_markup: { inline_keyboard: [[{ text: "⚡ Lineup", callback_data: "t:abc:l" }]] },
            }),
            expect.objectContaining({ text: "settled" }),
        ]);
    });

    it("takes screenshots sent as files, refuses other files, and reports failures", async () => {
        const slip = vi.fn().mockRejectedValue(new Error("API down"));
        const { bot } = setup({ slip });
        await bot.handleUpdate(message({ document: { file_id: "d", file_unique_id: "d", mime_type: "image/png" } }));
        expect(slip).toHaveBeenCalledWith(200, expect.objectContaining({ mediaType: "image/png" }));
        await bot.handleUpdate(
            message({ document: { file_id: "p", file_unique_id: "p", mime_type: "application/pdf" } }, 2),
        );
        expect(sent("sendMessage").map((payload) => payload.text)).toEqual([
            "Sorry, I could not read that slip. Try again in a minute.",
            "Send the bet slip as a photo or screenshot.",
        ]);
    });

    it("edits the card when a button is tapped", async () => {
        const tap = vi.fn().mockResolvedValue({ text: "✅ Logged" });
        const { bot } = setup({ tap });
        await bot.handleUpdate({
            update_id: 3,
            callback_query: {
                id: "q",
                from,
                chat_instance: "c",
                data: "t:abc:l",
                message: { message_id: 11, date: 0, chat, from: botInfo, text: "card" },
            },
        });
        expect(tap).toHaveBeenCalledWith(200, "t:abc:l");
        expect(sent("editMessageText")).toEqual([expect.objectContaining({ message_id: 11, text: "✅ Logged" })]);
        expect(sent("answerCallbackQuery")).toHaveLength(1);
    });

    it("hints at screenshots for other messages from allowed chats only", async () => {
        const isAllowed = vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false);
        const { bot } = setup({ isAllowed });
        await bot.handleUpdate(message({ text: "hi" }));
        await bot.handleUpdate(message({ text: "hi" }, 2));
        expect(sent("sendMessage").map((payload) => payload.text)).toEqual(["Send a screenshot of the bet slip."]);
    });

    it("sends messages with or without buttons", async () => {
        const { bot } = setup({});
        await bot.messenger.send(100, { text: "plain" });
        await bot.messenger.send(100, { text: "ask", keyboard: [[{ text: "✅ Allow", data: "ap:200" }]] });
        expect(sent("sendMessage")).toEqual([
            { chat_id: 100, text: "plain" },
            {
                chat_id: 100,
                text: "ask",
                reply_markup: { inline_keyboard: [[{ text: "✅ Allow", callback_data: "ap:200" }]] },
            },
        ]);
    });
});

describe("screenshotStore", () => {
    let dir: string;
    beforeEach(async () => {
        dir = await mkdtemp(join(tmpdir(), "slips-"));
    });
    afterEach(async () => {
        await rm(dir, { recursive: true, force: true });
    });

    it("keeps each screenshot in a folder per day", async () => {
        const path = await screenshotStore(dir)(
            { data: Buffer.from("png"), mediaType: "image/png" },
            new Date("2026-11-08T14:15:00Z"),
        );
        expect(path).toMatch(new RegExp(`^${dir}/2026-11-08/1794147300000-\\w+\\.png$`));
        expect(await readFile(path, "utf8")).toBe("png");
    });
});
