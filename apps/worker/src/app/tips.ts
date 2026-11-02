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

/** The tip as a Telegram message: every book that pays enough, best first. Everyone gets the same text. */
export function formatTip(tip: Tip, timeZone: string): string | undefined {
    const offers = tip.offers;
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
    muted: boolean;
}

/** Every bettor with a Telegram chat and whether they paused tips; the owner is always included. */
export function tipRecipients(
    players: readonly Pick<Player, "kind" | "telegramChatId" | "tipsMuted">[],
    ownerChatId: number,
): TipRecipient[] {
    const bettors = players.flatMap((player) =>
        player.kind === "bettor" && player.telegramChatId !== null
            ? [{ chatId: Number(player.telegramChatId), muted: player.tipsMuted }]
            : [],
    );
    if (bettors.some((bettor) => bettor.chatId === ownerChatId)) return bettors;
    return [{ chatId: ownerChatId, muted: false }, ...bettors];
}

/** Sends the same tip to every recipient who has not paused tips. */
export function createTipSender(options: {
    recipients: () => Promise<TipRecipient[]>;
    send: (chatId: number, text: string) => Promise<void>;
    timeZone: string;
    logger: Logger;
}): (tip: Tip) => Promise<void> {
    return async (tip) => {
        const text = formatTip(tip, options.timeZone);
        if (!text) return;
        const recipients = (await options.recipients()).filter((recipient) => !recipient.muted);
        await Promise.all(recipients.map((recipient) => options.send(recipient.chatId, text)));
        const sent = recipients.length;
        options.logger.info({ pick: tip.pick, offers: tip.offers.length, sent }, "value tip sent");
    };
}
