import type { Config } from "@closing-line/config";
import type { Player, Repositories } from "@closing-line/db";
import { z } from "zod";
import { hasAction, type ButtonHandler, type Messenger, type Reply } from "./chat.ts";

export const WELCOME =
    "Send /log right after placing a bet. I ask for the match, market, pick, bookmaker, odds and stake one at a time, then you tap why you took it.\n\n" +
    "When a bet is over, /open settles it (won, lost, void or cashed out). /undo deletes the last bet you logged.\n" +
    "You also get value tips, the same ones the owner gets; /tips off pauses them.";
export const WAITING = 'Still waiting for the owner to let you in. Send /log once you get "You\'re in!".';

const storedRequest = z.object({ name: z.string() });

export interface BettorsDeps {
    repos: Pick<Repositories, "players" | "chats">;
    config: Pick<Config, "bettors"> & { telegram: { ownerChatId: number } };
    messenger: Messenger;
    now?: () => Date;
}

/**
 * Who may use the bot and their own settings (spec §4). The owner always may; anyone else sends `/start` and waits
 * for the owner's Allow button. Join requests are stored, so they survive a restart.
 */
export class Bettors implements ButtonHandler {
    private readonly deps: BettorsDeps;
    private readonly now: () => Date;

    constructor(deps: BettorsDeps) {
        this.deps = deps;
        this.now = deps.now ?? (() => new Date());
    }

    private get ownerChatId(): number {
        return this.deps.config.telegram.ownerChatId;
    }

    async isAllowed(chatId: number): Promise<boolean> {
        return chatId === this.ownerChatId || (await this.player(chatId)) !== undefined;
    }

    /** Whether the chat asked to join and the owner has not answered yet. */
    async isWaiting(chatId: number): Promise<boolean> {
        return (await this.deps.repos.chats.get(chatId, "join_request")) !== undefined;
    }

    player(chatId: number): Promise<Player | undefined> {
        return this.deps.repos.players.byChat(chatId);
    }

    /** `/start`: welcomes known bettors and asks the owner about anyone else. */
    async start(chatId: number, name: string): Promise<Reply> {
        if (await this.isAllowed(chatId)) return { text: WELCOME };
        if (await this.isWaiting(chatId)) return { text: WAITING };
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

    owns(data: string): boolean {
        return hasAction(data, ["ap", "dn"]);
    }

    /** The owner's Allow (`ap:<chat>`) or Deny (`dn:<chat>`) on a join request. */
    async tap(chatId: number, data: string): Promise<Reply> {
        const [action, value = ""] = data.split(":");
        const requester = Number(value);
        if (chatId !== this.ownerChatId || !Number.isInteger(requester)) return { text: "Only the owner can decide." };
        const request = storedRequest.safeParse((await this.deps.repos.chats.get(requester, "join_request"))?.value);
        const name = request.success ? request.data.name : `Telegram ${requester}`;
        await this.deps.repos.chats.remove(requester, "join_request");
        if (action !== "ap") return { text: `${name} was not let in.` };
        await this.ensure(requester, name);
        await this.deps.messenger.send(requester, { text: `You're in! ${WELCOME}` });
        return { text: `${name} can now log bets.` };
    }

    /** `/tips on|off`: value tips for this person. */
    async tips(chatId: number, name: string, argument: string): Promise<Reply> {
        if (!(await this.isAllowed(chatId))) return { text: "Send /start first." };
        const playerId = await this.ensure(chatId, name);
        const word = argument.trim().toLowerCase();
        if (word !== "on" && word !== "off") {
            const muted = (await this.player(chatId))?.tipsMuted ?? false;
            return { text: `Value tips are ${muted ? "off" : "on"}. Send /tips on or /tips off.` };
        }
        await this.deps.repos.players.setTipsMuted(playerId, word === "off");
        return { text: word === "off" ? "Value tips are off. /tips on brings them back." : "Value tips are on." };
    }

    /** The chat's player id, creating the player with the bettors' starting bankroll the first time. */
    async ensure(chatId: number, name: string): Promise<string> {
        const existing = await this.player(chatId);
        if (existing) return existing.id;
        // The owner's player row is named "Owner" whatever their Telegram name is.
        const owner = chatId === this.ownerChatId;
        const id = owner ? "owner" : `tg_${chatId}`;
        await this.deps.repos.players.ensure([
            {
                id,
                name: owner ? "Owner" : name,
                kind: "bettor",
                startingBankrollOre: Math.round(this.deps.config.bettors.startingBankroll * 100),
                telegramChatId: String(chatId),
            },
        ]);
        return id;
    }
}
