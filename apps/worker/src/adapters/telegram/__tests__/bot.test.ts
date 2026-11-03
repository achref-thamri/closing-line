import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BetFlow } from "../../../app/betFlow.ts";
import type { Bettors } from "../../../app/bettors.ts";
import { hasAction, type Reply } from "../../../app/chat.ts";
import type { SettleFlow } from "../../../app/settleFlow.ts";
import { silentLogger } from "../../../lib/logger.ts";
import { COMMANDS, createTelegramBot } from "../bot.ts";

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

/** Stand-in flows: each owns its real button prefixes and does only what a test passes in. */
function setup(flows: { bettors?: Partial<Bettors>; bets?: Partial<BetFlow>; settle?: Partial<SettleFlow> } = {}) {
    const bot = createTelegramBot({ botToken: "1:secret", logger: silentLogger, botInfo });
    bot.api.config.use((_prev, method, payload) => {
        calls.push({ method, payload });
        return Promise.resolve({ ok: true, result: true } as never);
    });
    const owns = (actions: string[]) => (data: string) => hasAction(data, actions);
    bot.attach({
        bettors: { owns: owns(["ap", "dn"]), ...flows.bettors } as Bettors,
        bets: { owns: owns(["w", "t", "x", "tb"]), ...flows.bets } as BetFlow,
        settle: { owns: owns(["st", "hd"]), amount: () => Promise.resolve(undefined), ...flows.settle } as SettleFlow,
    });
    return bot;
}

function message(extra: Record<string, unknown>, updateId = 1) {
    return { update_id: updateId, message: { message_id: 10, date: 0, chat, from, ...extra } };
}

function command(name: string, updateId = 1) {
    return message(
        { text: name, entities: [{ type: "bot_command", offset: 0, length: name.split(" ")[0]?.length }] },
        updateId,
    );
}

function tapUpdate(data: string, updateId = 1) {
    return {
        update_id: updateId,
        callback_query: {
            id: "q",
            from,
            chat_instance: "c",
            data,
            message: { message_id: 11, date: 0, chat, from: botInfo, text: "question" },
        },
    };
}

const sent = (method: string) => calls.filter((call) => call.method === method).map((call) => call.payload);
const question: Reply = { text: "New bet. Which sport?", keyboard: [[{ text: "⚽ Football", data: "w:football" }]] };

beforeEach(() => {
    calls = [];
});

describe("bet bot", () => {
    it("answers /start, /log, /tips and /open", async () => {
        const isAllowed = vi.fn().mockResolvedValue(true);
        const start = vi.fn().mockResolvedValue({ text: "Welcome" });
        const bet = vi.fn().mockResolvedValue(question);
        const tips = vi.fn().mockResolvedValue({ text: "Value tips are off." });
        const open = vi.fn().mockResolvedValue([{ text: "No open bets." }]);
        const bot = setup({ bettors: { isAllowed, start, tips }, bets: { bet }, settle: { open } });
        await bot.handleUpdate(command("/start"));
        await bot.handleUpdate(command("/log", 2));
        await bot.handleUpdate(command("/tips off", 3));
        await bot.handleUpdate(command("/open", 4));
        expect(start).toHaveBeenCalledWith(200, "Sam");
        expect(tips).toHaveBeenCalledWith(200, "Sam", "off");
        expect(sent("sendMessage")).toEqual([
            expect.objectContaining({ text: "Welcome" }),
            expect.objectContaining({
                text: "New bet. Which sport?",
                reply_markup: { inline_keyboard: [[{ text: "⚽ Football", callback_data: "w:football" }]] },
            }),
            expect.objectContaining({ text: "Value tips are off." }),
            expect.objectContaining({ text: "No open bets." }),
        ]);
    });

    it("routes button taps and edits the question in place", async () => {
        const tap = vi.fn().mockResolvedValue({ text: "Which match?" });
        const settleTap = vi.fn().mockResolvedValue({ text: "✅ won" });
        const decide = vi.fn().mockResolvedValue({ text: "Sam can now log bets." });
        const bot = setup({ bettors: { tap: decide }, bets: { tap }, settle: { tap: settleTap } });
        await bot.handleUpdate(tapUpdate("w:football"));
        await bot.handleUpdate(tapUpdate("st:b1:w", 2));
        await bot.handleUpdate(tapUpdate("ap:300", 3));
        await bot.handleUpdate(tapUpdate("zz:1", 4));
        expect(tap).toHaveBeenCalledWith(200, "w:football");
        expect(settleTap).toHaveBeenCalledWith(200, "st:b1:w");
        expect(decide).toHaveBeenCalledWith(200, "ap:300");
        expect(sent("editMessageText").map((payload) => payload.text)).toEqual([
            "Which match?",
            "✅ won",
            "Sam can now log bets.",
            "Unknown button.",
        ]);
        expect(sent("answerCallbackQuery")).toHaveLength(4);
    });

    it("answers a tap with a new message when asked, leaving the tapped message (a tip) as it is", async () => {
        const tap = vi.fn().mockResolvedValue({ text: "Did you get 3.25?", newMessage: true });
        const bot = setup({ bets: { tap } });
        await bot.handleUpdate(tapUpdate("tb:f:away:nordicbet:3.25"));
        expect(sent("editMessageText")).toEqual([]);
        expect(sent("sendMessage").map((payload) => payload.text)).toEqual(["Did you get 3.25?"]);
        expect(sent("answerCallbackQuery")).toHaveLength(1);
    });

    it("gives typed text to a waiting cash-out first, then to the bet being entered", async () => {
        const amount = vi.fn().mockResolvedValueOnce({ text: "💰 cashed out" }).mockResolvedValueOnce(undefined);
        const text = vi.fn().mockResolvedValue([{ text: "Which market?" }]);
        const bot = setup({ bets: { text }, settle: { amount } });
        await bot.handleUpdate(message({ text: "2557" }));
        await bot.handleUpdate(message({ text: "Bayern – Arsenal" }, 2));
        expect(text).toHaveBeenCalledWith(200, "Bayern – Arsenal");
        expect(sent("sendMessage").map((payload) => payload.text)).toEqual(["💰 cashed out", "Which market?"]);
    });

    it("points bettors who send screenshots to /log and ignores strangers' files", async () => {
        const isAllowed = vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false);
        const bot = setup({ bettors: { isAllowed } });
        const photo = { photo: [{ file_id: "p", file_unique_id: "p", width: 1, height: 1 }] };
        await bot.handleUpdate(message(photo));
        await bot.handleUpdate(message(photo, 2));
        expect(sent("sendMessage").map((payload) => payload.text)).toEqual([
            "Screenshots are not read. Send /log and answer the questions instead.",
        ]);
    });

    it("keeps /bet working and puts the commands in Telegram's menu on start", async () => {
        const bet = vi.fn().mockResolvedValue(question);
        const bot = setup({ bets: { bet } });
        await bot.handleUpdate(command("/bet"));
        expect(bet).toHaveBeenCalledWith(200);
        expect(COMMANDS.map((each) => each.command)).toEqual(["log", "open", "undo", "picks", "tips", "start"]);
    });

    it("sends messages with or without buttons", async () => {
        const bot = setup();
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
