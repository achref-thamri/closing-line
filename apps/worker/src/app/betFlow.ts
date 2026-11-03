import type { Config } from "@closing-line/config";
import { bookName, fixtureNamed, isOutcome, teamsOf } from "@closing-line/core";
import type { Bet, NewBet, Repositories } from "@closing-line/db";
import { z } from "zod";
import type { Logger } from "../lib/logger.ts";
import { WAITING, type Bettors } from "./bettors.ts";
import { hasAction, rows, type Button, type ButtonHandler, type Messenger, type Reply } from "./chat.ts";
import { describeBet, kroner, parseDecimal, parseKroner, type BetCard } from "./format.ts";

export const TAGS = {
    l: { tag: "lineup", label: "⚡ Lineup" },
    s: { tag: "skewed_price", label: "📈 Skewed price" },
    g: { tag: "game_read", label: "🧠 Game read" },
    v: { tag: "slow_live_price", label: "⏱ Slow live price" },
    p: { tag: "value_tip", label: "🔎 Value tip" },
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

/** A typed match is looked up among fixtures from this long ago (bets placed live) to a week ahead. */
const LIVE_MS = 3 * 3_600_000;
const WEEK_MS = 7 * 86_400_000;

/** The same bet logged again within this long is checked with the bettor first. */
const TWIN_MS = 24 * 3_600_000;

/** A bet being entered waits this long for the next answer; then it has to be started again. */
const DRAFT_TTL_MS = 60 * 60 * 1000;

const STEPS = ["sport", "match", "market", "player", "pick", "book", "odds", "stake", "reason"] as const;
type Step = (typeof STEPS)[number];

/** A complete bet as entered, one answer at a time. */
export interface Draft {
    sport: Sport;
    eventName: string;
    /** The fixture the typed match names, when it is one we track; null otherwise. */
    fixtureId: string | null;
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
            fixtureId: z.string().nullable(),
            market: z.string(),
            playerName: z.string().nullable(),
            selection: z.string(),
            line: z.number().nullable(),
            bookmaker: z.string(),
            odds: z.number(),
            stakeOre: z.int(),
            /** Started from a tip's "I bet this" button: logged as a value tip once the stake is in. */
            fromTip: z.boolean(),
        })
        .partial(),
});

/** The answers so far for a bet being entered. */
type Answers = z.infer<typeof storedDraft>["draft"];

interface Pending {
    step: Step;
    draft: Answers;
    updatedAt: Date;
}

export interface BetFlowDeps {
    repos: Pick<Repositories, "bets" | "chats" | "fixtures">;
    bettors: Pick<Bettors, "isAllowed" | "isWaiting" | "ensure" | "player">;
    config: Pick<Config, "bettors" | "timezone"> & { telegram: { ownerChatId: number } };
    messenger: Messenger;
    logger: Logger;
    now?: () => Date;
}

/**
 * Logging a bet in Telegram (spec §4): `/log` asks one question at a time (buttons where the answers are known, typed
 * text for the match, player, odds and stake), and a tap on a reason logs the bet. Each answer is checked when it
 * arrives, so a logged bet is complete. The answers so far are stored, so a restart does not lose them. A typed
 * match that names a fixture we track is linked to it: a match-result bet on it then gets a closing price and CLV,
 * and settles itself, like the scanner's.
 */
export class BetFlow implements ButtonHandler {
    private readonly deps: BetFlowDeps;
    private readonly now: () => Date;

    constructor(deps: BetFlowDeps) {
        this.deps = deps;
        this.now = deps.now ?? (() => new Date());
    }

    private get ownerChatId(): number {
        return this.deps.config.telegram.ownerChatId;
    }

    /** `/log` (or `/bet`): starts a new bet, replacing one left half-entered. */
    async bet(chatId: number): Promise<Reply> {
        if (!(await this.deps.bettors.isAllowed(chatId))) {
            return { text: (await this.deps.bettors.isWaiting(chatId)) ? WAITING : "Send /start first." };
        }
        const pending: Pending = { step: "sport", draft: {}, updatedAt: this.now() };
        const reply = this.ask(pending, "sport");
        await this.save(chatId, pending);
        return reply;
    }

    /** A typed message: the answer to the current question, or a hint when no bet is being entered. */
    async text(chatId: number, text: string): Promise<Reply[]> {
        if (!(await this.deps.bettors.isAllowed(chatId))) {
            return (await this.deps.bettors.isWaiting(chatId)) ? [{ text: WAITING }] : [];
        }
        const pending = await this.current(chatId);
        if (!pending) return [{ text: "Send /log to log a bet, or /open to settle one." }];
        const reply = await this.answer(pending, text.trim());
        if (pending.step === "reason" && pending.draft.fromTip) return [await this.log(chatId, pending, "p")];
        await this.save(chatId, pending);
        return [reply];
    }

    private async answer(pending: Pending, answer: string): Promise<Reply> {
        const { draft } = pending;
        switch (pending.step) {
            case "match":
                if (answer.length < 3) return { text: "Which match? E.g. Bayern – Arsenal" };
                return this.match(pending, answer);
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
                const amount = parseKroner(answer);
                if (amount === undefined) return { text: "The stake in kroner, e.g. 1500" };
                draft.stakeOre = Math.round(amount * 100);
                return this.ask(pending, "reason");
            }
            case "sport":
            case "market":
            case "reason":
                return { text: "Tap one of the buttons above, or send /log to start again." };
        }
    }

    /**
     * Answers (`w:<value>`), reasons (`t:<tag>`, `t:<tag>:again` to log a twin), Cancel (`x`), a tip's "I bet this"
     * (`tb:…`) and `/undo`'s Delete (`u:<bet>`) and Keep (`uk`).
     */
    owns(data: string): boolean {
        return hasAction(data, ["w", "t", "x", "tb", "u", "uk"]);
    }

    /** `/undo`: offers to delete the last bet the chat logged, while it is still open. */
    async undo(chatId: number): Promise<Reply> {
        if (!(await this.deps.bettors.isAllowed(chatId))) return { text: "Send /start first." };
        const player = await this.deps.bettors.player(chatId);
        const own = player ? (await this.deps.repos.bets.forPlayer(player.id)).filter((bet) => bet.selfReported) : [];
        const last = own.at(-1);
        if (!last) return { text: "You have not logged a bet yet." };
        if (last.status !== "open") return { text: `${describeBet(last)}\n\nThis bet is settled, so it stays.` };
        return {
            text: `${describeBet(last)}\n\nDelete this bet?`,
            keyboard: [
                [
                    { text: "🗑 Delete", data: `u:${last.id}` },
                    { text: "Keep it", data: "uk" },
                ],
            ],
        };
    }

    async tap(chatId: number, data: string): Promise<Reply> {
        const separator = data.indexOf(":");
        const action = separator < 0 ? data : data.slice(0, separator);
        const value = separator < 0 ? "" : data.slice(separator + 1);
        if (action === "tb") return { ...(await this.fromTip(chatId, value)), newMessage: true };
        if (action === "uk") return { text: "Kept. /undo again any time while the bet is open." };
        if (action === "u") return this.remove(chatId, value);
        const pending = await this.current(chatId);
        if (!pending) return { text: "This bet is no longer open. Send /log to start again." };
        if (action === "x") {
            await this.deps.repos.chats.remove(chatId, "bet_draft");
            return { text: "Cancelled. /log starts a new one." };
        }
        const [tag = "", again] = value.split(":");
        if (action === "t" && tag in TAGS && pending.step === "reason") {
            return this.log(chatId, pending, tag as TagKey, again === "again");
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
        const odds = pending.step === "odds" ? parseDecimal(value) : undefined;
        if (odds !== undefined && odds > 1) {
            draft.odds = odds;
            return this.ask(pending, "stake");
        }
        return this.ask(pending, pending.step);
    }

    /**
     * A tip's "I bet this" (`<fixture>:<selection>:<bookmaker>:<odds>`): a bet with the match, pick, bookmaker and
     * the tip's price filled in, so only the odds check and the stake are left. A tip already logged is not
     * logged again.
     */
    private async fromTip(chatId: number, value: string): Promise<Reply> {
        if (!(await this.deps.bettors.isAllowed(chatId))) return { text: "Send /start first." };
        const [fixtureId = "", selection = "", bookmaker = "", price = ""] = value.split(":");
        const fixture = await this.deps.repos.fixtures.get(fixtureId);
        const odds = parseDecimal(price);
        if (!fixture || !isOutcome(selection) || !bookmaker || odds === undefined) {
            return { text: "That tip can no longer be logged. Send /log to log the bet." };
        }
        const player = await this.deps.bettors.player(chatId);
        const logged = player ? await this.deps.repos.bets.forPlayer(player.id) : [];
        const twin = logged.find((bet) => bet.fixtureId === fixtureId && bet.selection === selection);
        if (twin) return { text: `${describeBet(twin)}\n\nAlready logged. /open settles it if it is over.` };

        const pending: Pending = {
            step: "odds",
            draft: {
                sport: "football",
                eventName: `${fixture.homeTeam} – ${fixture.awayTeam}`,
                fixtureId,
                market: "match_result",
                playerName: null,
                selection,
                line: null,
                bookmaker,
                odds,
                fromTip: true,
            },
            updatedAt: this.now(),
        };
        const reply = this.ask(pending, "odds");
        await this.save(chatId, pending);
        return reply;
    }

    /** Links the typed match to a fixture we track when exactly one fits, and names it the way the fixture does. */
    private async match(pending: Pending, answer: string): Promise<Reply> {
        const { draft } = pending;
        const now = this.now().getTime();
        const fixtures =
            draft.sport === "football"
                ? await this.deps.repos.fixtures.between(new Date(now - LIVE_MS), new Date(now + WEEK_MS), "scheduled")
                : [];
        const fixture = fixtureNamed(answer, fixtures);
        draft.fixtureId = fixture?.id ?? null;
        draft.eventName = fixture ? `${fixture.homeTeam} – ${fixture.awayTeam}` : answer;
        const reply = this.ask(pending, "market");
        if (!fixture) return reply;
        const kickoff = fixture.kickoff.toLocaleString("en-GB", {
            timeZone: this.deps.config.timezone,
            weekday: "short",
            hour: "2-digit",
            minute: "2-digit",
        });
        return { ...reply, text: `✓ Kickoff ${kickoff}; a match-result bet gets a closing price.\n${reply.text}` };
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
                if (draft.fromTip && draft.odds !== undefined) {
                    const odds = draft.odds.toFixed(2);
                    return {
                        text: `${draft.eventName ?? ""}\nDid you get ${odds}? Tap it, or type the odds you got.`,
                        keyboard: [[{ text: `✅ ${odds}`, data: `w:${odds}` }], [CANCEL]],
                    };
                }
                return { text: "What odds did you get? E.g. 3.70", keyboard: [[CANCEL]] };
            case "stake":
                return { text: "How much did you stake, in kroner? E.g. 1500", keyboard: [[CANCEL]] };
            case "reason": {
                const tags = Object.entries(TAGS).map(([key, { label }]) => ({ text: label, data: `t:${key}` }));
                return {
                    text: `${describeBet(cardOf(draft as Draft))}\n\nWhy did you take it? Tap a reason to log the bet.`,
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

    /** Logs the bet; one identical to a bet logged in the last day is checked with the bettor first. */
    private async log(chatId: number, pending: Pending, tagKey: TagKey, again = false): Promise<Reply> {
        const draft = pending.draft as Draft;
        const playerId = await this.deps.bettors.ensure(chatId, "");
        const bet = this.toBet(playerId, draft, TAGS[tagKey].tag);
        const card = describeBet(cardOf(draft));
        const twin = again ? undefined : await this.twinOf(bet);
        if (twin) {
            await this.save(chatId, { ...pending, step: "reason" });
            const at = (twin.receivedAt ?? twin.createdAt).toLocaleTimeString("en-GB", {
                timeZone: this.deps.config.timezone,
                hour: "2-digit",
                minute: "2-digit",
            });
            return {
                text: `${card}\n\nYou logged this exact bet at ${at}. Log it again?`,
                keyboard: [[{ text: "Yes, it is a second bet", data: `t:${tagKey}:again` }], [CANCEL]],
            };
        }
        await this.deps.repos.chats.remove(chatId, "bet_draft");
        await this.deps.repos.bets.place(bet);
        this.deps.logger.info({ playerId, bookmaker: draft.bookmaker, market: draft.market }, "bet logged");
        if (chatId !== this.ownerChatId) {
            // Telegram chats with a bot are private, so the owner hears about other bettors' bets from the bot.
            const name = (await this.deps.bettors.player(chatId))?.name ?? playerId;
            await this.deps.messenger.send(this.ownerChatId, {
                text: `📝 ${name} logged:\n${card}\n${TAGS[tagKey].label}`,
            });
        }
        const cap = this.deps.config.bettors.maxBankrollFraction * this.deps.config.bettors.startingBankroll * 100;
        const capNote = draft.stakeOre > cap ? `\nNote: the stake is above the ${kroner(cap)} cap.` : "";
        return { text: `${card}\n\n✅ Logged as ${TAGS[tagKey].label}.${capNote}\n/log logs another.` };
    }

    /** A bet the player logged in the last day with the same match, pick, bookmaker, odds and stake. */
    private async twinOf(bet: NewBet): Promise<Bet | undefined> {
        const since = this.now().getTime() - TWIN_MS;
        return (await this.deps.repos.bets.forPlayer(bet.playerId)).find(
            (other) =>
                (other.receivedAt ?? other.createdAt).getTime() >= since &&
                other.eventName === bet.eventName &&
                other.market === bet.market &&
                other.selection === bet.selection &&
                other.playerName === (bet.playerName ?? null) &&
                other.line === (bet.line ?? null) &&
                other.bookmaker === bet.bookmaker &&
                other.lockedOdds === bet.lockedOdds &&
                other.stakeOre === bet.stakeOre,
        );
    }

    private async remove(chatId: number, betId: string): Promise<Reply> {
        const player = await this.deps.bettors.player(chatId);
        const bet = player ? await this.deps.repos.bets.get(betId) : undefined;
        if (!player || !bet || !(await this.deps.repos.bets.removeOwnOpen(betId, player.id))) {
            return { text: "That bet is settled or already gone, so nothing was deleted." };
        }
        this.deps.logger.info({ playerId: player.id }, "bet deleted");
        if (chatId !== this.ownerChatId) {
            await this.deps.messenger.send(this.ownerChatId, {
                text: `🗑 ${player.name} deleted:\n${describeBet(bet)}`,
            });
        }
        return { text: `${describeBet(bet)}\n\n🗑 Deleted. /log logs it again if you need to.` };
    }

    private toBet(playerId: string, draft: Draft, tag: NewBet["tag"]): NewBet {
        const now = this.now();
        return {
            playerId,
            fixtureId: draft.fixtureId,
            sport: draft.sport,
            eventName: draft.eventName,
            // A match result on a tracked fixture is stored like the scanner's, so it gets a closing price and settles.
            market:
                draft.fixtureId && draft.market === "match_result" && isOutcome(draft.selection) ? "h2h" : draft.market,
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
}

const CANCEL: Button = { text: "✖ Cancel", data: "x" };

/** A complete draft as the card the bettor sees. */
function cardOf(draft: Draft): BetCard {
    return { ...draft, lockedOdds: draft.odds };
}
