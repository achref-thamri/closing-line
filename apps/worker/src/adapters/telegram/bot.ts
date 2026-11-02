import { Bot, InlineKeyboard, type Context } from "grammy";
import type { UserFromGetMe } from "grammy/types";
import type { BetFlow, Keyboard, Messenger, Reply } from "../../app/betFlow.ts";
import type { SettleFlow } from "../../app/settleFlow.ts";
import type { Logger } from "../../lib/logger.ts";

export const COMMANDS = [
    { command: "log", description: "Log a bet you just placed" },
    { command: "open", description: "Settle your open bets" },
    { command: "picks", description: "Best prices for the next two days" },
    { command: "tips", description: "Turn value tips on or off" },
    { command: "start", description: "Join or show the help" },
];

function keyboardOf(rows: Keyboard | undefined): InlineKeyboard | undefined {
    if (!rows) return undefined;
    return InlineKeyboard.from(rows.map((row) => row.map((button) => InlineKeyboard.text(button.text, button.data))));
}

/** grammY bot for the bet flow, long polling. The token stays inside grammY and is never logged. */
export function createBetBot(options: {
    botToken: string;
    logger: Logger;
    /** Tests pass this to run updates without Telegram. */
    botInfo?: UserFromGetMe;
}) {
    const bot = new Bot(options.botToken, options.botInfo ? { botInfo: options.botInfo } : {});
    const messenger: Messenger = {
        async send(chatId: number, reply: Reply) {
            const keyboard = keyboardOf(reply.keyboard);
            await bot.api.sendMessage(chatId, reply.text, keyboard ? { reply_markup: keyboard } : {});
        },
    };

    async function sendAll(ctx: Context, replies: Reply[]): Promise<void> {
        for (const reply of replies) {
            const keyboard = keyboardOf(reply.keyboard);
            await ctx.reply(reply.text, keyboard ? { reply_markup: keyboard } : {});
        }
    }

    /** `picks` answers /picks; it reads stored odds only. */
    function attach(flow: BetFlow, settle: SettleFlow, picks?: () => Promise<string>): void {
        bot.command("start", async (ctx) => {
            await ctx.reply((await flow.start(ctx.chat.id, ctx.from?.first_name ?? "Someone")).text);
        });

        // /log is the name in the menu; /bet stays for anyone who learned it first.
        bot.command(["log", "bet"], async (ctx) => {
            await sendAll(ctx, [await flow.bet(ctx.chat.id)]);
        });

        bot.command("tips", async (ctx) => {
            await ctx.reply((await flow.tips(ctx.chat.id, ctx.from?.first_name ?? "Someone", ctx.match)).text);
        });

        bot.command("picks", async (ctx) => {
            if (picks && (await flow.isAllowed(ctx.chat.id))) await ctx.reply(await picks());
        });

        bot.command("open", async (ctx) => {
            if (await flow.isAllowed(ctx.chat.id)) await sendAll(ctx, await settle.open(ctx.chat.id));
        });

        bot.on(["message:photo", "message:document"], async (ctx) => {
            if (await flow.isAllowed(ctx.chat.id)) {
                await ctx.reply("Screenshots are not read. Send /log and answer the questions instead.");
            }
        });

        bot.on("callback_query:data", async (ctx) => {
            const chatId = ctx.chat?.id;
            if (chatId === undefined) {
                await ctx.answerCallbackQuery();
                return;
            }
            const data = ctx.callbackQuery.data;
            const reply = /^(st|hd):/.test(data) ? await settle.tap(chatId, data) : await flow.tap(chatId, data);
            const keyboard = keyboardOf(reply.keyboard);
            await ctx.editMessageText(reply.text, keyboard ? { reply_markup: keyboard } : {});
            await ctx.answerCallbackQuery();
        });

        bot.on("message:text", async (ctx) => {
            const amount = await settle.amount(ctx.chat.id, ctx.message.text);
            await sendAll(ctx, amount ? [amount] : await flow.text(ctx.chat.id, ctx.message.text));
        });

        bot.catch((error) => {
            options.logger.error({ error: error.message }, "telegram update failed");
        });
    }

    return {
        messenger,
        attach,
        api: bot.api,
        handleUpdate: (update: Parameters<typeof bot.handleUpdate>[0]) => bot.handleUpdate(update),
        start: async () => {
            // The menu next to the message box lists these, so nobody has to remember them.
            await bot.api.setMyCommands(COMMANDS);
            await bot.start({ drop_pending_updates: false, allowed_updates: ["message", "callback_query"] });
        },
        stop: () => bot.stop(),
    };
}
