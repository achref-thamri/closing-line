import type { Config } from "@closing-line/config";
import { bookName, pickText, teamsOf } from "@closing-line/core";
import type { NewBet, Repositories } from "@closing-line/db";
import { z } from "zod";
import type { Logger } from "../lib/logger.ts";

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

/** Markets offered as buttons: `line` asks over/under, `result` home/draw/away, `team` a side, `free` a typed pick. */
const MARKETS = {
    player_shots_on_target: { label: "Shots on target", kind: "line", player: true },
    player_shots: { label: "Shots", kind: "line", player: true },
    player_fouls: { label: "Fouls", kind: "line", player: true },
    player_cards: { label: "Cards", kind: "line", player: true },
    corners: { label: "Corners", kind: "line", player: false },
    match_result: { label: "Match result", kind: "result", player: false },
    match_winner: { label: "Winner", kind: "team", player: false },
    other: { label: "Other", kind: "free", player: false },
} as const;
type MarketKey = keyof typeof MARKETS;

type Sport = "football" | "counter_strike";
const SPORT_MARKETS: Record<Sport, MarketKey[]> = {
    football: [
        "player_shots_on_target",
        "player_shots",
        "player_fouls",
        "player_cards",
        "corners",
        "match_result",
        "other",
    ],
    counter_strike: ["match_winner", "other"],
};

/** The friend's books first (spec §4), then other books used in Denmark. */
const BOOKS = [
    "nordicbet",
    "bet25",
    "danske_spil",
    "comeon",
    "betano",
    "marathonbet",
    "campobet",
    "merkurbets",
    "unibet",
    "leovegas",
    "bet365",
];
const LINES = [0.5, 1.5, 2.5, 3.5];

/** A bet being entered waits this long for the next answer; then it has to be started again. */
const DRAFT_TTL_MS = 60 * 60 * 1000;

const STEPS = ["sport", "match", "market", "player", "pick", "book", "odds", "stake", "reason"] as const;
type Step = (typeof STEPS)[number];

/** A complete bet as entered, one answer at a time. */
export interface Draft {
    sport: Sport;
    eventName: string;
    market: string;
    playerName: string | null;
    selection: string;
    line: number | null;
    bookmaker: string;
    odds: number;
    stakeOre: number;
}

/** A stored draft is read back through this, so a row written by an older version cannot break the flow. */
const storedDraft = z.object({
    step: z.enum(STEPS),
    draft: z
        .object({
            sport: z.enum(["football", "counter_strike"]),
            eventName: z.string(),
            market: z.string(),
            playerName: z.string().nullable(),
            selection: z.string(),
            line: z.number().nullable(),
            bookmaker: z.string(),
            odds: z.number(),
            stakeOre: z.int(),
        })
        .partial(),
});
const storedRequest = z.object({ name: z.string() });

/** The answers so far for a bet being entered. */
type Answers = z.infer<typeof storedDraft>["draft"];

interface Pending {
    step: Step;
    draft: Answers;
    updatedAt: Date;
}

export interface BetFlowDeps {
    repos: Pick<Repositories, "players" | "bets" | "chats">;
    config: Pick<Config, "bettors"> & { telegram: { ownerChatId: number } };
    messenger: Messenger;
    logger: Logger;
    now?: () => Date;
}

/**
 * The Telegram bet flow (spec §4): the owner approves who may log bets; a bettor logs a bet with `/log`, answering
 * one question at a time (buttons where the answers are known, typed text for the match, player, odds and stake),
 * and tags it with a reason. Each answer is checked when it arrives, so a logged bet is complete. Bets being entered
 * and join requests are stored in the database, so they survive a restart.
 */
export class BetFlow {
    private readonly deps: BetFlowDeps;
    private readonly now: () => Date;

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
        if (await this.requested(chatId)) return { text: WAITING };
        await this.deps.repos.chats.put(chatId, "join_request", { name }, this.now());
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

    /** `/log` (or `/bet`): starts a new bet, replacing one left half-entered. */
    async bet(chatId: number): Promise<Reply> {
        if (!(await this.isAllowed(chatId))) {
            return { text: (await this.requested(chatId)) ? WAITING : "Send /start first." };
        }
        const pending: Pending = { step: "sport", draft: {}, updatedAt: this.now() };
        const reply = this.ask(pending, "sport");
        await this.save(chatId, pending);
        return reply;
    }

    /** A typed message: the answer to the current question, or a hint when no bet is being entered. */
    async text(chatId: number, text: string): Promise<Reply[]> {
        if (!(await this.isAllowed(chatId))) return (await this.requested(chatId)) ? [{ text: WAITING }] : [];
        const pending = await this.current(chatId);
        if (!pending) return [{ text: "Send /log to log a bet, or /open to settle one." }];
        const reply = this.answer(pending, text.trim());
        await this.save(chatId, pending);
        return [reply];
    }

    private answer(pending: Pending, answer: string): Reply {
        const { draft } = pending;
        switch (pending.step) {
            case "match":
                if (answer.length < 3) return { text: "Which match? E.g. Bayern – Arsenal" };
                draft.eventName = answer;
                return this.ask(pending, "market");
            case "player":
                if (answer.length < 2) return { text: "Which player? E.g. Davies" };
                draft.playerName = answer;
                return this.ask(pending, "pick");
            case "pick":
                return this.typedPick(pending, answer);
            case "book":
                if (answer.length < 2) return { text: "Which bookmaker?" };
                draft.bookmaker = answer.toLowerCase().replace(/\s+/g, "_");
                return this.ask(pending, "odds");
            case "odds": {
                const odds = parseDecimal(answer);
                if (odds === undefined || odds <= 1 || odds > 1000) return { text: "The odds as a number, e.g. 3.70" };
                draft.odds = odds;
                return this.ask(pending, "stake");
            }
            case "stake": {
                const kroner = parseKroner(answer);
                if (kroner === undefined) return { text: "The stake in kroner, e.g. 1500" };
                draft.stakeOre = Math.round(kroner * 100);
                return this.ask(pending, "reason");
            }
            case "sport":
            case "market":
            case "reason":
                return { text: "Tap one of the buttons above, or send /log to start again." };
        }
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
        const separator = data.indexOf(":");
        const action = separator < 0 ? data : data.slice(0, separator);
        const value = separator < 0 ? "" : data.slice(separator + 1);
        if (action === "ap" || action === "dn") return this.decide(chatId, action === "ap", Number(value));
        const pending = await this.current(chatId);
        if (!pending) return { text: "This bet is no longer open. Send /log to start again." };
        if (action === "x") {
            await this.deps.repos.chats.remove(chatId, "bet_draft");
            return { text: "Cancelled. /log starts a new one." };
        }
        if (action === "t" && value in TAGS && pending.step === "reason") {
            return this.log(chatId, pending, value as TagKey);
        }
        if (action !== "w") return { text: "Unknown button." };
        const reply = this.choose(pending, value);
        await this.save(chatId, pending);
        return reply;
    }

    /** A button answer for the current question; anything else asks the question again. */
    private choose(pending: Pending, value: string): Reply {
        const { draft } = pending;
        if (pending.step === "sport" && (value === "football" || value === "counter_strike")) {
            draft.sport = value;
            return this.ask(pending, "match");
        }
        if (pending.step === "market" && value in MARKETS) {
            draft.market = value;
            draft.playerName = null;
            return this.ask(pending, MARKETS[value as MarketKey].player ? "player" : "pick");
        }
        if (pending.step === "pick" && value !== "") {
            const [selection = "", line] = value.split("|");
            draft.selection = selection;
            draft.line = line === undefined ? null : Number(line);
            return this.ask(pending, "book");
        }
        if (pending.step === "book" && BOOKS.includes(value)) {
            draft.bookmaker = value;
            return this.ask(pending, "odds");
        }
        return this.ask(pending, pending.step);
    }

    /** A typed pick: "over 9.5" for line markets, the backed side or outcome otherwise. */
    private typedPick(pending: Pending, answer: string): Reply {
        const { draft } = pending;
        if (MARKETS[draft.market as MarketKey].kind === "line") {
            const match = /^(over|under|o|u)\s*(\d+(?:[.,]\d+)?)$/i.exec(answer);
            if (!match) return { text: "Type the line like over 9.5 or under 2.5" };
            draft.selection = match[1]?.toLowerCase().startsWith("u") ? "under" : "over";
            draft.line = parseDecimal(match[2] ?? "") ?? null;
        } else {
            if (answer.length < 2) return { text: "What did you back?" };
            draft.selection = answer;
            draft.line = null;
        }
        return this.ask(pending, "book");
    }

    /** Moves to `step` and asks its question. */
    private ask(pending: Pending, step: Step): Reply {
        pending.step = step;
        pending.updatedAt = this.now();
        const { draft } = pending;
        switch (step) {
            case "sport":
                return {
                    text: "New bet. Which sport?",
                    keyboard: [
                        [
                            { text: "⚽ Football", data: "w:football" },
                            { text: "🎮 Counter-Strike", data: "w:counter_strike" },
                        ],
                        [CANCEL],
                    ],
                };
            case "match":
                return { text: "Which match? Type it, e.g. Bayern – Arsenal", keyboard: [[CANCEL]] };
            case "market": {
                const buttons = SPORT_MARKETS[draft.sport ?? "football"].map((key) => ({
                    text: MARKETS[key].label,
                    data: `w:${key}`,
                }));
                return { text: `${draft.eventName ?? ""}\nWhich market?`, keyboard: [...rows(buttons, 2), [CANCEL]] };
            }
            case "player":
                return { text: "Which player? Type the name, e.g. Davies", keyboard: [[CANCEL]] };
            case "pick":
                return this.askPick(draft);
            case "book": {
                const buttons = BOOKS.map((book) => ({ text: bookName(book), data: `w:${book}` }));
                return { text: "Which bookmaker? Tap it, or type another.", keyboard: [...rows(buttons, 3), [CANCEL]] };
            }
            case "odds":
                return { text: "What odds did you get? E.g. 3.70", keyboard: [[CANCEL]] };
            case "stake":
                return { text: "How much did you stake, in kroner? E.g. 1500", keyboard: [[CANCEL]] };
            case "reason": {
                const tags = Object.entries(TAGS).map(([key, { label }]) => ({ text: label, data: `t:${key}` }));
                return {
                    text: `${describe(draft as Draft)}\n\nWhy did you take it? Tap a reason to log the bet.`,
                    keyboard: [...rows(tags, 2), [CANCEL]],
                };
            }
        }
    }

    private askPick(draft: Answers): Reply {
        const market = MARKETS[draft.market as MarketKey];
        if (market.kind === "line") {
            const subject = draft.playerName ? `${draft.playerName}, ${market.label.toLowerCase()}` : market.label;
            const buttons = LINES.map((line) => ({ text: `Over ${line}`, data: `w:over|${line}` }));
            return {
                text: `${subject}: which line? Tap it, or type another (e.g. over 9.5 or under 2.5).`,
                keyboard: [...rows(buttons, 2), [CANCEL]],
            };
        }
        const [home, away] = teamsOf(draft.eventName ?? "");
        if (market.kind === "result" && home && away) {
            const sides = [
                { text: home, data: "w:home" },
                { text: "Draw", data: "w:draw" },
                { text: away, data: "w:away" },
            ];
            return { text: "Which result?", keyboard: [sides, [CANCEL]] };
        }
        if (market.kind === "team" && home && away) {
            const sides = [
                { text: home, data: `w:${home}` },
                { text: away, data: `w:${away}` },
            ];
            return { text: "Who did you back?", keyboard: [sides, [CANCEL]] };
        }
        return { text: "What did you back? Type it.", keyboard: [[CANCEL]] };
    }

    private async decide(chatId: number, allow: boolean, requester: number): Promise<Reply> {
        if (chatId !== this.ownerChatId || !Number.isInteger(requester)) return { text: "Only the owner can decide." };
        const request = storedRequest.safeParse((await this.deps.repos.chats.get(requester, "join_request"))?.value);
        const name = request.success ? request.data.name : `Telegram ${requester}`;
        await this.deps.repos.chats.remove(requester, "join_request");
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

    private async log(chatId: number, pending: Pending, tagKey: TagKey): Promise<Reply> {
        const draft = pending.draft as Draft;
        await this.deps.repos.chats.remove(chatId, "bet_draft");
        const playerId = await this.ensureBettor(chatId, "");
        await this.deps.repos.bets.place(this.toBet(playerId, draft, TAGS[tagKey].tag));
        this.deps.logger.info({ playerId, bookmaker: draft.bookmaker, market: draft.market }, "bet logged");
        if (chatId !== this.ownerChatId) {
            // Telegram chats with a bot are private, so the owner hears about other bettors' bets from the bot.
            const name = (await this.deps.repos.players.byChat(chatId))?.name ?? playerId;
            await this.deps.messenger.send(this.ownerChatId, {
                text: `📝 ${name} logged:\n${describe(draft)}\n${TAGS[tagKey].label}`,
            });
        }
        const cap = this.deps.config.bettors.maxBankrollFraction * this.deps.config.bettors.startingBankroll * 100;
        const capNote = draft.stakeOre > cap ? `\nNote: the stake is above the ${kroner(cap)} cap.` : "";
        return { text: `${describe(draft)}\n\n✅ Logged as ${TAGS[tagKey].label}.${capNote}\n/log logs another.` };
    }

    private toBet(playerId: string, draft: Draft, tag: NewBet["tag"]): NewBet {
        const now = this.now();
        return {
            playerId,
            fixtureId: null,
            sport: draft.sport,
            eventName: draft.eventName,
            market: draft.market,
            selection: draft.selection,
            playerName: draft.playerName,
            line: draft.line,
            stakeOre: draft.stakeOre,
            lockedOdds: draft.odds,
            bookmaker: draft.bookmaker,
            receivedAt: now,
            selfReported: true,
            tag,
        };
    }

    /** The chat's bet in progress, dropped once it has waited too long or no longer reads as a draft. */
    private async current(chatId: number): Promise<Pending | undefined> {
        const session = await this.deps.repos.chats.get(chatId, "bet_draft");
        if (!session) return undefined;
        const stored = storedDraft.safeParse(session.value);
        if (!stored.success || this.now().getTime() - session.updatedAt.getTime() > DRAFT_TTL_MS) {
            await this.deps.repos.chats.remove(chatId, "bet_draft");
            return undefined;
        }
        return { ...stored.data, updatedAt: session.updatedAt };
    }

    private async save(chatId: number, pending: Pending): Promise<void> {
        await this.deps.repos.chats.put(
            chatId,
            "bet_draft",
            { step: pending.step, draft: pending.draft },
            pending.updatedAt,
        );
    }

    private async requested(chatId: number): Promise<boolean> {
        return (await this.deps.repos.chats.get(chatId, "join_request")) !== undefined;
    }
}

const CANCEL: Button = { text: "✖ Cancel", data: "x" };
const WELCOME =
    "Send /log right after placing a bet. I ask for the match, market, pick, bookmaker, odds and stake one at a time, then you tap why you took it.\n\n" +
    "When a bet is over, /open settles it (won, lost, void or cashed out).\n" +
    "You also get value tips, the same ones the owner gets; /tips off pauses them.";
const WAITING = 'Still waiting for the owner to let you in. Send /log once you get "You\'re in!".';

function rows(buttons: Button[], size: number): Keyboard {
    const result: Keyboard = [];
    for (let i = 0; i < buttons.length; i += size) result.push(buttons.slice(i, i + size));
    return result;
}

type Described = Pick<
    Draft,
    "eventName" | "market" | "selection" | "playerName" | "line" | "bookmaker" | "odds" | "stakeOre"
>;

/** The card text for a bet. */
export function describe(bet: Described): string {
    return [
        `🧾 ${bookName(bet.bookmaker)} · ${bet.eventName}`,
        pickText(bet),
        `Odds ${bet.odds.toFixed(2)} · Stake ${kroner(bet.stakeOre)}`,
    ].join("\n");
}

export function kroner(ore: number): string {
    return `${(ore / 100).toLocaleString("en-GB", { maximumFractionDigits: 2 })} kr`;
}

/** "3.70" or "3,70" as a number; undefined otherwise. */
export function parseDecimal(text: string): number | undefined {
    if (!/^\d+(?:[.,]\d+)?$/.test(text.trim())) return undefined;
    return Number(text.trim().replace(",", "."));
}

/** Reads "2557", "2557 kr", "2.557,17" (Danish) or "2,557.17" as kroner; undefined when it is not one amount. */
export function parseKroner(text: string): number | undefined {
    const cleaned = text.replace(/kr\.?|dkk/gi, "").replace(/\s/g, "");
    if (!/^\d[\d.,]*$/.test(cleaned)) return undefined;
    const lastSeparator = Math.max(cleaned.lastIndexOf(","), cleaned.lastIndexOf("."));
    const decimals = lastSeparator >= 0 && cleaned.length - lastSeparator - 1 <= 2 ? lastSeparator : -1;
    const whole = (decimals >= 0 ? cleaned.slice(0, decimals) : cleaned).replace(/[.,]/g, "");
    const fraction = decimals >= 0 ? cleaned.slice(decimals + 1) : "";
    const value = Number(`${whole}.${fraction || "0"}`);
    return Number.isFinite(value) && value > 0 ? value : undefined;
}
