import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Bot, InlineKeyboard, type Context } from "grammy";
import type { UserFromGetMe } from "grammy/types";
import type { BetFlow, Keyboard, Messenger, Reply } from "../../app/betFlow.ts";
import type { SettleFlow } from "../../app/settleFlow.ts";
import type { Fetch } from "../../lib/http.ts";
import type { Logger } from "../../lib/logger.ts";
import type { SlipImage } from "../../ports/slips.ts";

const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

/** Stores screenshots under `dir/YYYY-MM-DD/` with a time-based name; returns the path. */
export function screenshotStore(dir: string) {
    return async (image: SlipImage, receivedAt: Date): Promise<string> => {
        const day = receivedAt.toISOString().slice(0, 10);
        const extension = image.mediaType.split("/")[1] ?? "jpeg";
        const path = join(dir, day, `${receivedAt.getTime()}-${Math.random().toString(36).slice(2, 8)}.${extension}`);
        await mkdir(join(dir, day), { recursive: true });
        await writeFile(path, image.data, { mode: 0o600 });
        return path;
    };
}

function keyboardOf(rows: Keyboard | undefined): InlineKeyboard | undefined {
    if (!rows) return undefined;
    return InlineKeyboard.from(rows.map((row) => row.map((button) => InlineKeyboard.text(button.text, button.data))));
}

/** grammY bot for the bet flow, long polling. The token stays inside grammY and is never logged. */
export function createBetBot(options: {
    botToken: string;
    logger: Logger;
    /** Tests pass these to run updates without Telegram. */
    botInfo?: UserFromGetMe;
    fetch?: Fetch;
}) {
    const bot = new Bot(options.botToken, options.botInfo ? { botInfo: options.botInfo } : {});
    const doFetch = options.fetch ?? fetch;
    const messenger: Messenger = {
        async send(chatId: number, reply: Reply) {
            const keyboard = keyboardOf(reply.keyboard);
            await bot.api.sendMessage(chatId, reply.text, keyboard ? { reply_markup: keyboard } : {});
        },
    };

    async function download(ctx: Context, fileId: string, mediaType: SlipImage["mediaType"]): Promise<SlipImage> {
        const file = await ctx.api.getFile(fileId);
        if (!file.file_path) throw new Error("Telegram returned no file path");
        const response = await doFetch(`https://api.telegram.org/file/bot${options.botToken}/${file.file_path}`, {
            signal: AbortSignal.timeout(30_000),
        });
        if (!response.ok) throw new Error(`file download failed with ${response.status}`);
        return { data: Buffer.from(await response.arrayBuffer()), mediaType };
    }

    async function sendAll(ctx: Context, replies: Reply[]): Promise<void> {
        for (const reply of replies) {
            const keyboard = keyboardOf(reply.keyboard);
            await ctx.reply(reply.text, keyboard ? { reply_markup: keyboard } : {});
        }
    }

    function attach(flow: BetFlow, settle: SettleFlow): void {
        bot.command("start", async (ctx) => {
            await ctx.reply((await flow.start(ctx.chat.id, ctx.from?.first_name ?? "Someone")).text);
        });

        bot.command("tips", async (ctx) => {
            await ctx.reply((await flow.tips(ctx.chat.id, ctx.from?.first_name ?? "Someone", ctx.match)).text);
        });

        bot.command("books", async (ctx) => {
            await sendAll(ctx, [await flow.books(ctx.chat.id, ctx.from?.first_name ?? "Someone")]);
        });

        bot.command("open", async (ctx) => {
            if (await flow.isAllowed(ctx.chat.id)) await sendAll(ctx, await settle.open(ctx.chat.id));
        });

        bot.on(["message:photo", "message:document"], async (ctx) => {
            const photo = ctx.message.photo?.at(-1);
            const document = ctx.message.document;
            let image: Promise<SlipImage>;
            if (photo) image = download(ctx, photo.file_id, "image/jpeg");
            else if (document?.mime_type && IMAGE_TYPES.has(document.mime_type))
                image = download(ctx, document.file_id, document.mime_type as SlipImage["mediaType"]);
            else {
                await ctx.reply("Send the bet slip as a photo or screenshot.");
                return;
            }
            await ctx.replyWithChatAction("typing");
            try {
                await sendAll(ctx, await flow.slip(ctx.chat.id, await image));
            } catch (error) {
                options.logger.error({ error: (error as Error).message }, "slip could not be read");
                await ctx.reply("Sorry, I could not read that slip. Try again in a minute.");
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
            try {
                const amount = await settle.amount(ctx.chat.id, ctx.message.text);
                await sendAll(ctx, amount ? [amount] : await flow.typed(ctx.chat.id, ctx.message.text));
            } catch (error) {
                options.logger.error({ error: (error as Error).message }, "typed bet could not be read");
                await ctx.reply("Sorry, I could not read that. Try again in a minute.");
            }
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
        start: () => bot.start({ drop_pending_updates: false, allowed_updates: ["message", "callback_query"] }),
        stop: () => bot.stop(),
    };
}
