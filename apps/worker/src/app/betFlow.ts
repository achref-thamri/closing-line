import { randomBytes } from "node:crypto";
import type { Config } from "@closing-line/config";
import { zonedTimeToUtc } from "@closing-line/core";
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
    config: Pick<Config, "humans" | "timezone"> & { telegram: { ownerChatId: number } };
    messenger: Messenger;
    /** Keeps the screenshot as evidence and returns where it was stored. */
    saveScreenshot: (image: SlipImage, receivedAt: Date) => Promise<string>;
    logger: Logger;
    now?: () => Date;
}

/**
 * The Telegram bet flow (spec §4): the owner approves who may log bets; a human sends a screenshot of an
 * open bet slip, checks the card for each bet on it and logs it with a tag.
 */
export class BetFlow {
    private readonly deps: BetFlowDeps;
    private readonly now: () => Date;
    private readonly drafts = new Map<string, PendingDraft>();
    private readonly requests = new Map<number, string>();

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

    /** `/start`: welcomes known humans and asks the owner about anyone else. */
    async start(chatId: number, name: string): Promise<Reply> {
        if (await this.isAllowed(chatId)) return { text: WELCOME };
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
        if (!(await this.isAllowed(chatId))) return [{ text: "Send /start first." }];
        const receivedAt = this.now();
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
        if (!(await this.isAllowed(chatId))) return [];
        // Every bet has odds and a stake, so a message without digits is not one; no need to ask Claude.
        if (!/\d/.test(text)) return [{ text: TYPING_HELP }];
        const receivedAt = this.now();
        this.expireDrafts(receivedAt);
        const drafts = await this.deps.reader.readText(text);
        if (drafts.length === 0) return [{ text: `I could not find a bet in that. ${TYPING_HELP}` }];
        return this.cards(chatId, drafts, null, receivedAt);
    }

    private cards(chatId: number, drafts: SlipDraft[], screenshotPath: string | null, receivedAt: Date): Reply[] {
        const source = screenshotPath === null ? "\n✍️ Typed, no screenshot" : "";
        return drafts.map((draft) => {
            if (draft.status !== "open") {
                return {
                    text: `${describe(draft)}\n\nAlready ${statusWord(draft.status)}, so not logged: only bets sent before they settle count. Send the slip right after placing the bet.`,
                };
            }
            const id = randomBytes(6).toString("base64url");
            this.drafts.set(id, { chatId, draft, screenshotPath, receivedAt });
            return {
                text: `${describe(draft)}${source}\n\nWhy did you take it? Tap a reason to log the bet.`,
                keyboard: draftKeyboard(id, draft),
            };
        });
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
        await this.ensureHuman(requester, name);
        await this.deps.messenger.send(requester, { text: `You're in! ${WELCOME}` });
        return { text: `${name} can now log bets.` };
    }

    private async ensureHuman(chatId: number, name: string): Promise<string> {
        const existing = await this.deps.repos.players.byChat(chatId);
        if (existing) return existing.id;
        const id = chatId === this.ownerChatId ? "owner" : `tg_${chatId}`;
        await this.deps.repos.players.ensure([
            {
                id,
                name,
                kind: "human",
                startingBankrollOre: Math.round(this.deps.config.humans.startingBankroll * 100),
                telegramChatId: String(chatId),
            },
        ]);
        return id;
    }

    private async log(id: string, pending: PendingDraft, tagKey: TagKey): Promise<Reply> {
        const { draft } = pending;
        const playerId = await this.ensureHuman(pending.chatId, "Owner");
        const placed = await this.deps.repos.bets.place(this.toBet(playerId, pending, TAGS[tagKey].tag));
        this.drafts.delete(id);
        if (!placed) return { text: `${describe(draft)}\n\nAlready logged.` };
        this.deps.logger.info({ playerId, bookmaker: draft.bookmaker, market: draft.market }, "slip bet logged");

        const cap = this.deps.config.humans.maxBankrollFraction * this.deps.config.humans.startingBankroll * 100;
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

    private expireDrafts(now: Date): void {
        for (const [id, pending] of this.drafts) {
            if (now.getTime() - pending.receivedAt.getTime() > DRAFT_TTL_MS) this.drafts.delete(id);
        }
    }
}

const WELCOME =
    "Send a screenshot of your bet slip right after placing a bet, or type it. I read it, show you what I found, and you log it with one tap.";
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
    const market = MARKET_LABELS[draft.market] || draft.marketText;
    const line = draft.line === null ? "" : ` ${draft.line}`;
    const pick =
        draft.selection === "over" || draft.selection === "under"
            ? `${draft.playerName ?? ""} ${market} ${draft.selection}${line}`.trim()
            : `${draft.selection}${draft.playerName ? ` (${draft.playerName})` : ""} ${market}`.trim();
    const book = draft.bookmaker === "unknown" ? "Bookmaker? Tap it below" : bookName(draft.bookmaker);
    const lines = [
        `🧾 ${book} · ${draft.eventName}${draft.competition ? ` (${draft.competition})` : ""}`,
        pick,
        `Odds ${draft.odds.toFixed(2)} · Stake ${kroner(draft.stakeOre)}`,
    ];
    if (draft.placedAtLocal) lines.push(`Placed ${draft.placedAtLocal.replace("T", " ")}`);
    return lines.join("\n");
}

function bookName(book: string): string {
    return book
        .split("_")
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(" ");
}

function statusWord(status: SlipDraft["status"]): string {
    return status === "cashed_out" ? "cashed out" : status;
}

function kroner(ore: number): string {
    return `${(ore / 100).toLocaleString("en-GB", { maximumFractionDigits: 2 })} kr`;
}
