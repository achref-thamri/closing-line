import type { ValueOffer } from "@closing-line/core";
import type { Player } from "@closing-line/db";
import type { Logger } from "../lib/logger.ts";

/** Display names for The Odds API's bookmaker keys; unknown keys are shown as they are. */
export const BOOK_NAMES: Readonly<Record<string, string>> = {
    pinnacle: "Pinnacle",
    nordicbet: "NordicBet",
    marathonbet: "Marathonbet",
    betsson: "Betsson",
    unibet_se: "Unibet",
    leovegas_se: "LeoVegas",
    sport888: "888sport",
    casumo: "Casumo",
    coolbet: "Coolbet",
    betfair_ex_eu: "Betfair Exchange",
    matchbook: "Matchbook",
    williamhill: "William Hill",
};

export function bookName(bookmaker: string): string {
    return BOOK_NAMES[bookmaker] ?? bookmaker;
}

/** A value bet the scanner found, with every bookmaker that pays enough. */
export interface Tip {
    homeTeam: string;
    awayTeam: string;
    kickoff: Date;
    /** The team backed, or "Draw". */
    pick: string;
    fairOdds: number;
    offers: ValueOffer[];
    /** The scanner's own paper stake at the best offer. */
    paperStakeKr: number;
    seenAt: Date;
}

/**
 * The tip as a Telegram message, showing only `books` when given (null: all). Undefined when none of
 * those books pays enough, so the person is not sent a tip they cannot place.
 */
export function formatTip(tip: Tip, timeZone: string, books: readonly string[] | null = null): string | undefined {
    const offers = books ? tip.offers.filter((offer) => books.includes(offer.bookmaker)) : tip.offers;
    const [best] = offers;
    if (!best) return undefined;
    const percent = (edge: number) => `${(edge * 100).toFixed(1)}%`;
    const time = (date: Date, options: Intl.DateTimeFormatOptions) =>
        date.toLocaleString("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", ...options });
    const others = offers
        .slice(1)
        .map((offer) => `${bookName(offer.bookmaker)} ${offer.offeredOdds.toFixed(2)} (+${percent(offer.edge)})`);
    return [
        `🔎 Value bet: ${tip.pick} @ ${best.offeredOdds.toFixed(2)} at ${bookName(best.bookmaker)}`,
        `${tip.homeTeam} v ${tip.awayTeam}, ${time(tip.kickoff, { weekday: "short" })}`,
        ...(others.length > 0 ? [`Also: ${others.join(", ")}`] : []),
        `Fair ${tip.fairOdds.toFixed(2)}, edge ${percent(best.edge)}, paper stake ${tip.paperStakeKr} kr`,
        `💡 Pinnacle, the sharpest bookmaker, prices this at ${tip.fairOdds.toFixed(2)} once its margin is removed. ` +
            `${best.offeredOdds.toFixed(2)} pays ${percent(best.edge)} more than the bet is worth, so it wins money ` +
            `over many bets like it, not every time.`,
        `Price seen ${time(tip.seenAt, {})}; check it is still there before you bet.`,
    ].join("\n");
}

export interface TipRecipient {
    chatId: number;
    /** Null: every tracked book. */
    bookmakers: readonly string[] | null;
    muted: boolean;
}

/** Every human with a Telegram chat, with their settings; the owner gets every tip until they have settings. */
export function tipRecipients(
    players: readonly Pick<Player, "kind" | "telegramChatId" | "bookmakers" | "tipsMuted">[],
    ownerChatId: number,
): TipRecipient[] {
    const humans = players.flatMap((player) =>
        player.kind === "human" && player.telegramChatId !== null
            ? [{ chatId: Number(player.telegramChatId), bookmakers: player.bookmakers, muted: player.tipsMuted }]
            : [],
    );
    if (humans.some((human) => human.chatId === ownerChatId)) return humans;
    return [{ chatId: ownerChatId, bookmakers: null, muted: false }, ...humans];
}

/** Sends each recipient the tip filtered to their books, skipping muted people and tips they cannot place. */
export function createTipSender(options: {
    recipients: () => Promise<TipRecipient[]>;
    send: (chatId: number, text: string) => Promise<void>;
    timeZone: string;
    logger: Logger;
}): (tip: Tip) => Promise<void> {
    return async (tip) => {
        const recipients = await options.recipients();
        let sent = 0;
        await Promise.all(
            recipients.map(async (recipient) => {
                if (recipient.muted) return;
                const text = formatTip(tip, options.timeZone, recipient.bookmakers);
                if (!text) return;
                sent++;
                await options.send(recipient.chatId, text);
            }),
        );
        options.logger.info({ pick: tip.pick, offers: tip.offers.length, sent }, "value tip sent");
    };
}
