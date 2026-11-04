import { bookName, type Outcome, type ValueOffer } from "@closing-line/core";
import type { Player } from "@closing-line/db";
import { messageOf } from "../lib/errors.ts";
import type { Logger } from "../lib/logger.ts";
import type { Keyboard, Reply } from "./chat.ts";

/** "I bet this" buttons under a tip, one per bookmaker that pays enough, best first. */
const TIP_BUTTONS = 3;
/** Telegram's limit on a button's data. */
const MAX_BUTTON_DATA_BYTES = 64;

/** A value bet the scanner found, with every bookmaker that pays enough. */
export interface Tip {
    fixtureId: string;
    selection: Outcome;
    homeTeam: string;
    awayTeam: string;
    kickoff: Date;
    /** The team backed, or "Draw". */
    pick: string;
    fairOdds: number;
    /** The lowest price still worth backing at the scanner's edge threshold. */
    minOdds: number;
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
        `Price seen ${time(tip.seenAt, {})}. Worth it at ${tip.minOdds.toFixed(2)} or better, so check your bookmaker's price first.`,
    ].join("\n");
}

/** A tip whose price no bookmaker pays any more: by a later poll, every book is below the fair price. */
export interface PriceGone {
    homeTeam: string;
    awayTeam: string;
    kickoff: Date;
    /** The team backed, or "Draw". */
    pick: string;
    tippedOdds: number;
    tippedAt: Date;
    fairOdds: number;
    /** The best price on offer now, if any bookmaker still lists the selection. */
    best?: { bookmaker: string; offeredOdds: number };
}

export function formatPriceGone(gone: PriceGone, timeZone: string): string {
    const time = (date: Date) =>
        date.toLocaleString("en-GB", { timeZone, weekday: "short", hour: "2-digit", minute: "2-digit" });
    const now = gone.best
        ? `Best now ${gone.best.offeredOdds.toFixed(2)} at ${bookName(gone.best.bookmaker)}, below the fair ${gone.fairOdds.toFixed(2)}.`
        : `No bookmaker lists it now; fair is ${gone.fairOdds.toFixed(2)}.`;
    return [
        `⌛ Price gone: ${gone.pick}, tipped at ${gone.tippedOdds.toFixed(2)} on ${time(gone.tippedAt)}`,
        `${gone.homeTeam} v ${gone.awayTeam}, ${time(gone.kickoff)}`,
        `${now} If you haven't bet it, skip it. If you have, you got the better price.`,
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

/**
 * One "I bet this" button per bookmaker that pays enough: `tb:<fixture>:<selection>:<bookmaker>:<odds>`, which
 * the bet flow turns into a bet with everything but the stake filled in.
 */
export function tipKeyboard(tip: Tip): Keyboard {
    return tip.offers
        .slice(0, TIP_BUTTONS)
        .map((offer) => ({
            text: `✅ I bet this at ${bookName(offer.bookmaker)} ${offer.offeredOdds.toFixed(2)}`,
            data: `tb:${tip.fixtureId}:${tip.selection}:${offer.bookmaker}:${offer.offeredOdds.toFixed(2)}`,
        }))
        .filter((button) => Buffer.byteLength(button.data) <= MAX_BUTTON_DATA_BYTES)
        .map((button) => [button]);
}

interface SenderOptions {
    recipients: () => Promise<TipRecipient[]>;
    send: (chatId: number, reply: Reply) => Promise<void>;
    timeZone: string;
    logger: Logger;
}

/**
 * Sends one message to every recipient who has not paused tips and returns how many arrived. A message that fails
 * is logged; the others still go out.
 */
async function broadcast(options: SenderOptions, reply: Reply, what: string): Promise<number> {
    const recipients = (await options.recipients()).filter((recipient) => !recipient.muted);
    const results = await Promise.allSettled(recipients.map((recipient) => options.send(recipient.chatId, reply)));
    results.forEach((result, index) => {
        if (result.status === "rejected") {
            const chatId = recipients[index]?.chatId;
            options.logger.warn({ chatId, error: messageOf(result.reason) }, `${what} not delivered`);
        }
    });
    return results.filter((result) => result.status === "fulfilled").length;
}

/** Sends the same tip, with its "I bet this" buttons, to everyone who gets tips. */
export function createTipSender(options: SenderOptions): (tip: Tip) => Promise<void> {
    return async (tip) => {
        const text = formatTip(tip, options.timeZone);
        if (!text) return;
        const sent = await broadcast(options, { text, keyboard: tipKeyboard(tip) }, "value tip");
        options.logger.info({ pick: tip.pick, offers: tip.offers.length, sent }, "value tip sent");
    };
}

/** Tells everyone who got the tip that its price has gone. */
export function createPriceGoneSender(options: SenderOptions): (gone: PriceGone) => Promise<void> {
    return async (gone) => {
        const sent = await broadcast(options, { text: formatPriceGone(gone, options.timeZone) }, "price gone alert");
        options.logger.info({ pick: gone.pick, sent }, "price gone alert sent");
    };
}
