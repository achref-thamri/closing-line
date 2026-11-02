import { randomBytes } from "node:crypto";
import type { Config } from "@closing-line/config";
import { localTime, zonedTimeToUtc } from "@closing-line/core";
import type { NewBet, Repositories } from "@closing-line/db";
import type { Logger } from "../lib/logger.ts";
import type { SlipDraft, SlipImage, SlipReader } from "../ports/slips.ts";

export interface Button {
    text: string;
    data: string;
}
/** Rows of inline buttons under a message. */
export type Keyboard = Button[][];

export interface Reply {
    text: string;
    keyboard?: Keyboard;
}

/** Sends new messages; the Telegram adapter implements it. */
export interface Messenger {
    send(chatId: number, reply: Reply): Promise<void>;
}

export const TAGS = {
    l: { tag: "lineup", label: "⚡ Lineup" },
    s: { tag: "skewed_price", label: "📈 Skewed price" },
    g: { tag: "game_read", label: "🧠 Game read" },
    v: { tag: "slow_live_price", label: "⏱ Slow live price" },
} as const;
type TagKey = keyof typeof TAGS;

/** The friend's books (spec §4), offered when a slip shows no brand. */
const BOOKS = ["nordicbet", "bet25", "danske_spil", "comeon", "betano", "marathonbet", "campobet", "merkurbets"];

const MARKET_LABELS: Record<SlipDraft["market"], string> = {
    player_shots_on_target: "shots on target",
    player_shots: "shots",
    player_fouls: "fouls",
    player_cards: "cards",
    player_goal: "to score",
    corners: "corners",
    cards: "cards",
    match_result: "1X2",
    match_winner: "winner",
    other: "",
};

/** Drafts wait this long for a tap; after that the slip has to be sent again. */
const DRAFT_TTL_MS = 6 * 60 * 60 * 1000;

interface PendingDraft {
    chatId: number;
    draft: SlipDraft;
    /** Null for a typed bet: the bettor's word, reported apart from screenshot bets. */
    screenshotPath: string | null;
    receivedAt: Date;
}

export interface BetFlowDeps {
    reader: SlipReader;
    repos: Pick<Repositories, "players" | "bets">;
    config: Pick<Config, "bettors" | "timezone"> & {
        telegram: { ownerChatId: number };
    };
    messenger: Messenger;
    /** Keeps the screenshot as evidence and returns where it was stored. */
    saveScreenshot: (image: SlipImage, receivedAt: Date) => Promise<string>;
    logger: Logger;
    /** Settles an open bet when its settled slip arrives (`SettleFlow.fromSlip`). */
    settler?: { fromSlip(chatId: number, draft: SlipDraft): Promise<Reply | undefined> };
    now?: () => Date;
}

/**
 * The Telegram bet flow (spec §4): the owner approves who may log bets; a bettor sends a screenshot of an
 * open bet slip, checks the card for each bet on it and logs it with a tag.
 */
export class BetFlow {
    private readonly deps: BetFlowDeps;
    private readonly now: () => Date;
    private readonly drafts = new Map<string, PendingDraft>();
    private readonly requests = new Map<number, string>();
    /** Claude reads per chat today, keyed by the local date, to cap the bill. */
    private readonly reads = new Map<number, { date: string; count: number }>();

    constructor(deps: BetFlowDeps) {
        this.deps = deps;
        this.now = deps.now ?? (() => new Date());
    }

    private get ownerChatId(): number {
        return this.deps.config.telegram.ownerChatId;
    }

    async isAllowed(chatId: number): Promise<boolean> {
        return chatId === this.ownerChatId || (await this.deps.repos.players.byChat(chatId)) !== undefined;
    }

    /** `/start`: welcomes known bettors and asks the owner about anyone else. */
    async start(chatId: number, name: string): Promise<Reply> {
        if (await this.isAllowed(chatId)) return { text: WELCOME };
        if (this.requests.has(chatId)) return { text: WAITING };
        this.requests.set(chatId, name);
        await this.deps.messenger.send(this.ownerChatId, {
            text: `${name} wants to log bets with Closing Line.`,
            keyboard: [
                [
                    { text: "✅ Allow", data: `ap:${chatId}` },
                    { text: "✖ Deny", data: `dn:${chatId}` },
                ],
            ],
        });
        return { text: "Thanks! The owner has been asked to let you in. You will get a message when it is done." };
    }

    /** A screenshot: one card per bet on it. */
    async slip(chatId: number, image: SlipImage): Promise<Reply[]> {
        if (!(await this.isAllowed(chatId)))
            return [{ text: this.requests.has(chatId) ? WAITING : "Send /start first." }];
        const receivedAt = this.now();
        if (!this.takeRead(chatId, receivedAt)) return [{ text: this.limitText() }];
        this.expireDrafts(receivedAt);
        const [drafts, screenshotPath] = await Promise.all([
            this.deps.reader.read(image),
            this.deps.saveScreenshot(image, receivedAt),
        ]);
        if (drafts.length === 0)
            return [{ text: "I could not find a bet on that screenshot. Send the open bet slip." }];
        return this.cards(chatId, drafts, screenshotPath, receivedAt);
    }

    /** A bet typed as text, e.g. "Davies over 0.5 shots on target, Bayern–Arsenal, NordicBet, 3.70, 1500 kr". */
    async typed(chatId: number, text: string): Promise<Reply[]> {
        if (!(await this.isAllowed(chatId))) {
            // Someone who asked to join hears why nothing happens; anyone else is ignored.
            return this.requests.has(chatId) ? [{ text: WAITING }] : [];
        }
        // Every bet has odds and a stake, so a message without digits is not one; no need to ask Claude.
        if (!/\d/.test(text)) return [{ text: TYPING_HELP }];
        const receivedAt = this.now();
        if (!this.takeRead(chatId, receivedAt)) return [{ text: this.limitText() }];
        this.expireDrafts(receivedAt);
        const drafts = await this.deps.reader.readText(text);
        if (drafts.length === 0) return [{ text: `I could not find a bet in that. ${TYPING_HELP}` }];
        return this.cards(chatId, drafts, null, receivedAt);
    }

    private async cards(
        chatId: number,
        drafts: SlipDraft[],
        screenshotPath: string | null,
        receivedAt: Date,
    ): Promise<Reply[]> {
        const source = screenshotPath === null ? "\n✍️ Typed, no screenshot" : "";
        const replies: Reply[] = [];
        for (const draft of drafts) replies.push(await this.card(chatId, draft, source, screenshotPath, receivedAt));
        return replies;
    }

    private async card(
        chatId: number,
        draft: SlipDraft,
        source: string,
        screenshotPath: string | null,
        receivedAt: Date,
    ): Promise<Reply> {
        if (draft.status !== "open") {
            const settled = await this.deps.settler?.fromSlip(chatId, draft);
            if (settled) return settled;
            return {
                text: `${describe(draft)}\n\nAlready ${statusWord(draft.status)}, so not logged: only bets sent before they settle count. Send the slip right after placing the bet; to settle a logged bet use /open.`,
            };
        }
        const id = randomBytes(6).toString("base64url");
        this.drafts.set(id, { chatId, draft, screenshotPath, receivedAt });
        return {
            text: `${describe(draft)}${source}\n\nWhy did you take it? Tap a reason to log the bet.`,
            keyboard: draftKeyboard(id, draft),
        };
    }

    /** `/tips on|off`: value tips for this person. */
    async tips(chatId: number, name: string, argument: string): Promise<Reply> {
        if (!(await this.isAllowed(chatId))) return { text: "Send /start first." };
        const playerId = await this.ensureBettor(chatId, name);
        const word = argument.trim().toLowerCase();
        if (word !== "on" && word !== "off") {
            const muted = (await this.deps.repos.players.byChat(chatId))?.tipsMuted ?? false;
            return { text: `Value tips are ${muted ? "off" : "on"}. Send /tips on or /tips off.` };
        }
        await this.deps.repos.players.setTipsMuted(playerId, word === "off");
        return { text: word === "off" ? "Value tips are off. /tips on brings them back." : "Value tips are on." };
    }

    /** A button tap. Returns the new text for the message the button was on. */
    async tap(chatId: number, data: string): Promise<Reply> {
        const [action, id = "", extra = ""] = data.split(":");
        if (action === "ap" || action === "dn") return this.decide(chatId, action === "ap", Number(id));

        const pending = this.drafts.get(id);
        if (pending?.chatId !== chatId) return { text: "This bet has expired. Send the screenshot again." };
        if (action === "x") {
            this.drafts.delete(id);
            return { text: `${describe(pending.draft)}\n\nDiscarded.` };
        }
        if (action === "b" && BOOKS.includes(extra)) {
            pending.draft = { ...pending.draft, bookmaker: extra };
            return {
                text: `${describe(pending.draft)}\n\nWhy did you take it?`,
                keyboard: draftKeyboard(id, pending.draft),
            };
        }
        if (action === "t" && extra in TAGS) return this.log(id, pending, extra as TagKey);
        return { text: "Unknown button." };
    }

    private async decide(chatId: number, allow: boolean, requester: number): Promise<Reply> {
        if (chatId !== this.ownerChatId || !Number.isInteger(requester)) return { text: "Only the owner can decide." };
        const name = this.requests.get(requester) ?? `Telegram ${requester}`;
        this.requests.delete(requester);
        if (!allow) return { text: `${name} was not let in.` };
        await this.ensureBettor(requester, name);
        await this.deps.messenger.send(requester, { text: `You're in! ${WELCOME}` });
        return { text: `${name} can now log bets.` };
    }

    private async ensureBettor(chatId: number, name: string): Promise<string> {
        // The owner's player row is named "Owner" whatever their Telegram name is.
        if (chatId === this.ownerChatId) name = "Owner";
        const existing = await this.deps.repos.players.byChat(chatId);
        if (existing) return existing.id;
        const id = chatId === this.ownerChatId ? "owner" : `tg_${chatId}`;
        await this.deps.repos.players.ensure([
            {
                id,
                name,
                kind: "bettor",
                startingBankrollOre: Math.round(this.deps.config.bettors.startingBankroll * 100),
                telegramChatId: String(chatId),
            },
        ]);
        return id;
    }

    private async log(id: string, pending: PendingDraft, tagKey: TagKey): Promise<Reply> {
        const { draft } = pending;
        const playerId = await this.ensureBettor(pending.chatId, "");
        const placed = await this.deps.repos.bets.place(this.toBet(playerId, pending, TAGS[tagKey].tag));
        this.drafts.delete(id);
        if (!placed) return { text: `${describe(draft)}\n\nAlready logged.` };
        this.deps.logger.info({ playerId, bookmaker: draft.bookmaker, market: draft.market }, "slip bet logged");
        if (pending.chatId !== this.ownerChatId) {
            // Telegram chats with a bot are private, so the owner hears about other bettors' bets from the bot.
            const name = (await this.deps.repos.players.byChat(pending.chatId))?.name ?? playerId;
            const typed = pending.screenshotPath === null ? " · typed" : "";
            await this.deps.messenger.send(this.ownerChatId, {
                text: `📝 ${name} logged:\n${describe(draft)}\n${TAGS[tagKey].label}${typed}`,
            });
        }

        const cap = this.deps.config.bettors.maxBankrollFraction * this.deps.config.bettors.startingBankroll * 100;
        const capNote = draft.stakeOre > cap ? `\nNote: the stake is above the ${kroner(cap)} cap.` : "";
        return { text: `${describe(draft)}\n\n✅ Logged as ${TAGS[tagKey].label}.${capNote}` };
    }

    private toBet(playerId: string, pending: PendingDraft, tag: NewBet["tag"]): NewBet {
        const { draft } = pending;
        return {
            playerId,
            fixtureId: null,
            sport: draft.sport === "other" ? "football" : draft.sport,
            eventName: draft.eventName,
            competition: draft.competition,
            market: draft.market === "other" ? draft.marketText : draft.market,
            selection: draft.selection,
            playerName: draft.playerName,
            line: draft.line,
            stakeOre: draft.stakeOre,
            lockedOdds: draft.odds,
            bookmaker: draft.bookmaker,
            couponId: draft.couponId,
            placedAt: draft.placedAtLocal
                ? (zonedTimeToUtc(draft.placedAtLocal, this.deps.config.timezone) ?? null)
                : null,
            receivedAt: pending.receivedAt,
            selfReported: true,
            tag,
            screenshotPath: pending.screenshotPath,
        };
    }

    /** Counts one Claude read for the chat; false once today's allowance is used up. */
    private takeRead(chatId: number, now: Date): boolean {
        const date = localTime(now, this.deps.config.timezone).date;
        const today = this.reads.get(chatId);
        const count = today?.date === date ? today.count : 0;
        if (count >= this.deps.config.bettors.dailySlipReads) return false;
        this.reads.set(chatId, { date, count: count + 1 });
        return true;
    }

    private limitText(): string {
        return `You've reached today's limit of ${this.deps.config.bettors.dailySlipReads} slips. It resets at midnight; log the rest tomorrow.`;
    }

    private expireDrafts(now: Date): void {
        for (const [id, pending] of this.drafts) {
            if (now.getTime() - pending.receivedAt.getTime() > DRAFT_TTL_MS) this.drafts.delete(id);
        }
    }
}

const WELCOME =
    "Send a screenshot of your bet slip right after placing a bet, or type it. I read it, show you what I found, and you log it with one tap.\n\n" +
    "When a bet is over, /open settles it (won, lost, void or cashed out), or send the settled slip.\n" +
    "You also get value tips, the same ones the owner gets; /tips off pauses them.";
const WAITING = 'Still waiting for the owner to let you in. Send the bet again once you get "You\'re in!".';
const TYPING_HELP =
    'Send a screenshot of the slip, or type the bet with match, pick, bookmaker, odds and stake, e.g. "Davies over 0.5 shots on target, Bayern–Arsenal, NordicBet, 3.70, 1500 kr".';

function draftKeyboard(id: string, draft: SlipDraft): Keyboard {
    const tags = Object.entries(TAGS).map(([key, { label }]) => ({ text: label, data: `t:${id}:${key}` }));
    const rows: Keyboard = [tags.slice(0, 2), tags.slice(2, 4)];
    if (draft.bookmaker === "unknown") {
        const books = BOOKS.map((book) => ({ text: bookName(book), data: `b:${id}:${book}` }));
        rows.unshift(books.slice(0, 4), books.slice(4));
    }
    rows.push([{ text: "✖ Discard", data: `x:${id}` }]);
    return rows;
}

/** The card text for a bet. */
export function describe(draft: SlipDraft): string {
    const pick = pickText({ ...draft, market: MARKET_LABELS[draft.market] ? draft.market : draft.marketText });
    const book = draft.bookmaker === "unknown" ? "Bookmaker? Tap it below" : bookName(draft.bookmaker);
    const lines = [
        `🧾 ${book} · ${draft.eventName}${draft.competition ? ` (${draft.competition})` : ""}`,
        pick,
        `Odds ${draft.odds.toFixed(2)} · Stake ${kroner(draft.stakeOre)}`,
    ];
    if (draft.placedAtLocal) lines.push(`Placed ${draft.placedAtLocal.replace("T", " ")}`);
    return lines.join("\n");
}

/** What was backed, e.g. "Davies shots on target over 0.5" or "Team Liquid winner". */
export function pickText(bet: { market: string; selection: string; playerName: string | null; line: number | null }) {
    const market = (MARKET_LABELS as Record<string, string | undefined>)[bet.market] ?? bet.market;
    const line = bet.line === null ? "" : ` ${bet.line}`;
    return bet.selection === "over" || bet.selection === "under"
        ? `${bet.playerName ?? ""} ${market} ${bet.selection}${line}`.trim()
        : `${bet.selection}${bet.playerName ? ` (${bet.playerName})` : ""} ${market}`.trim();
}

export function bookName(book: string): string {
    return book
        .split("_")
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(" ");
}

function statusWord(status: SlipDraft["status"]): string {
    return status === "cashed_out" ? "cashed out" : status;
}

export function kroner(ore: number): string {
    return `${(ore / 100).toLocaleString("en-GB", { maximumFractionDigits: 2 })} kr`;
}
