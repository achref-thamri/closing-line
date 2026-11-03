import type { Api } from "grammy";
import type { Logger } from "./logger.ts";

/** A message to the owner: alerts, failed jobs, settlements. */
export type Notify = (message: string) => Promise<void>;
/** A plain-text message to any chat: tips, reminders, the weekly report. */
export type SendText = (chatId: number, text: string) => Promise<void>;

/**
 * Sends plain-text messages through the bot's API client. A failed message is logged, never thrown: a job should
 * not fail because a notification did. grammY's errors name the method, never the token.
 */
export function createTextSender(options: { api: Pick<Api, "sendMessage">; logger: Logger }): SendText {
    return async (chatId, text) => {
        try {
            await options.api.sendMessage(chatId, text, { link_preview_options: { is_disabled: true } });
        } catch (error) {
            options.logger.warn({ chatId, error: (error as Error).message }, "telegram message failed");
        }
    };
}
