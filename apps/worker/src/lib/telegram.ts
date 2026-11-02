import type { Fetch } from "./http.ts";
import type { Logger } from "./logger.ts";

export type Notify = (message: string) => Promise<void>;

/**
 * Sends plain-text messages to one Telegram chat. A failed message is logged, never thrown: a job should not
 * fail because a notification did. The token is part of the URL, so the URL is never logged.
 */
export function createTelegramNotifier(options: {
    botToken: string;
    chatId: number;
    logger: Logger;
    fetch?: Fetch;
}): Notify {
    const doFetch = options.fetch ?? fetch;
    return async (text) => {
        try {
            const response = await doFetch(`https://api.telegram.org/bot${options.botToken}/sendMessage`, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ chat_id: options.chatId, text, link_preview_options: { is_disabled: true } }),
                signal: AbortSignal.timeout(10_000),
            });
            if (!response.ok) options.logger.warn({ status: response.status }, "telegram message refused");
        } catch (error) {
            options.logger.warn({ error: (error as Error).name }, "telegram message failed");
        }
    };
}

/** Sends a message to every chat `chats()` lists at the moment of sending, e.g. all humans who may bet. */
export function createTelegramBroadcast(options: {
    botToken: string;
    chats: () => Promise<number[]>;
    logger: Logger;
    fetch?: Fetch;
}): Notify {
    return async (text) => {
        const chats = [...new Set(await options.chats())];
        await Promise.all(chats.map((chatId) => createTelegramNotifier({ ...options, chatId })(text)));
    };
}
