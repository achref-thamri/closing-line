import { cashoutGainOre, heldProfitOre, impliedOddsFromCashout, priceMove } from "@closing-line/core";
import type { Bet, Repositories, Settlement } from "@closing-line/db";
import { z } from "zod";
import type { Logger } from "../lib/logger.ts";
import { hasAction, type ButtonHandler, type Keyboard, type Messenger, type Reply } from "./chat.ts";
import { describeBet, kroner, parseKroner, signedKroner } from "./format.ts";

type Outcome = "won" | "lost" | "void";
type SlipSettlement = Omit<Settlement, "settledAt">;
const OUTCOME_KEYS: Record<string, Outcome> = { w: "won", l: "lost", v: "void" };
const storedCashout = z.object({ betId: z.string() });

export interface SettleFlowDeps {
    repos: Pick<Repositories, "players" | "bets" | "chats">;
    messenger: Messenger;
    ownerChatId: number;
    logger: Logger;
    now?: () => Date;
}

/**
 * Settling bettors' bets (spec §4): `/open` lists them with Won / Lost / Void / Cashed out buttons; a cash-out asks
 * for the amount, records the price it implies, then asks how the bet would have ended. The bet waiting for its
 * cash-out amount is stored in the database, so a restart in between does not lose it.
 */
export class SettleFlow implements ButtonHandler {
    private readonly deps: SettleFlowDeps;
    private readonly now: () => Date;

    constructor(deps: SettleFlowDeps) {
        this.deps = deps;
        this.now = deps.now ?? (() => new Date());
    }

    /** `/open`: one message per open bet, oldest first. */
    async open(chatId: number): Promise<Reply[]> {
        const player = await this.deps.repos.players.byChat(chatId);
        const open = player ? await this.deps.repos.bets.openFor(player.id) : [];
        if (open.length === 0) return [{ text: "No open bets." }];
        return open.map((bet) => ({
            text: `${describeBet(bet)}\n\nHow did it end?`,
            keyboard: settleKeyboard(bet.id),
        }));
    }

    /** Buttons `st:<bet>:<w|l|v|c>` (how the bet ended) and `hd:<bet>:<w|l|v>` (how a cashed-out bet would have). */
    owns(data: string): boolean {
        return hasAction(data, ["st", "hd"]);
    }

    async tap(chatId: number, data: string): Promise<Reply> {
        const [action, betId = "", key = ""] = data.split(":");
        const bet = await this.ownBet(chatId, betId);
        if (!bet) return { text: "That bet is not yours or no longer exists." };

        if (action === "hd") {
            const held = OUTCOME_KEYS[key];
            if (!held || bet.status !== "cashed_out") return { text: describeBet(bet) };
            await this.deps.repos.bets.setHeldStatus(bet.id, held);
            const gain = cashoutGainOre({ ...bet, cashoutOfferOre: bet.cashoutOfferOre ?? 0 }, held);
            const verdict =
                gain >= 0
                    ? `Cashing out paid ${kroner(gain)} more than holding.`
                    : `Holding would have paid ${kroner(-gain)} more.`;
            return { text: `${describeBet(bet)}\n\n💰 Cashed out. It would have ${held}. ${verdict}` };
        }

        if (bet.status !== "open") return { text: `${describeBet(bet)}\n\nAlready settled.` };
        if (key === "c") {
            await this.deps.repos.chats.put(chatId, "cashout", { betId: bet.id }, this.now());
            return { text: `${describeBet(bet)}\n\nHow much did the cash-out pay? Reply with the amount, e.g. 2557.` };
        }
        const outcome = OUTCOME_KEYS[key];
        if (action !== "st" || !outcome) return { text: "Unknown button." };
        return this.settle(chatId, bet, { status: outcome, profitOre: heldProfitOre(bet, outcome) });
    }

    /** A text reply while a cash-out amount is awaited; undefined when none is, so the text is a bet instead. */
    async amount(chatId: number, text: string): Promise<Reply | undefined> {
        const stored = storedCashout.safeParse((await this.deps.repos.chats.get(chatId, "cashout"))?.value);
        if (!stored.success) return undefined;
        const amount = parseKroner(text);
        if (amount === undefined) return { text: "Reply with just the amount, e.g. 2557 or 2.557,17." };
        await this.deps.repos.chats.remove(chatId, "cashout");
        const bet = await this.ownBet(chatId, stored.data.betId);
        if (bet?.status !== "open") return { text: "That bet is already settled." };
        return this.cashOut(chatId, bet, Math.round(amount * 100));
    }

    private async cashOut(chatId: number, bet: Bet, offerOre: number): Promise<Reply> {
        const implied = impliedOddsFromCashout(bet, offerOre);
        const settled = await this.settle(chatId, bet, {
            status: "cashed_out",
            profitOre: offerOre - bet.stakeOre,
            cashoutOfferOre: offerOre,
            ...(implied === undefined ? {} : { impliedCurrentOdds: implied, clv: priceMove(bet.lockedOdds, implied) }),
        });
        const move =
            implied === undefined
                ? ""
                : `\nThe cash-out implies the price moved from ${bet.lockedOdds.toFixed(2)} to about ${implied.toFixed(2)}.`;
        return {
            text: `${settled.text}${move}\n\nHow did the bet itself end?`,
            keyboard: [
                [
                    { text: "Would have won", data: `hd:${bet.id}:w` },
                    { text: "Would have lost", data: `hd:${bet.id}:l` },
                ],
                [{ text: "Void", data: `hd:${bet.id}:v` }],
            ],
        };
    }

    private async settle(chatId: number, bet: Bet, settlement: SlipSettlement): Promise<Reply> {
        const done = await this.deps.repos.bets.settle(bet.id, { ...settlement, settledAt: this.now() });
        if (!done) return { text: `${describeBet(bet)}\n\nAlready settled.` };
        const result = `${statusIcon(settlement.status)} ${settlement.status.replace("_", " ")} ${signedKroner(settlement.profitOre)}`;
        if (chatId !== this.deps.ownerChatId) {
            const name = (await this.deps.repos.players.byChat(chatId))?.name ?? bet.playerId;
            await this.deps.messenger.send(this.deps.ownerChatId, {
                text: `📝 ${name} settled:\n${describeBet(bet)}\n${result}`,
            });
        }
        this.deps.logger.info({ playerId: bet.playerId, status: settlement.status }, "bet settled");
        return { text: `${describeBet(bet)}\n\n${result}` };
    }

    private async ownBet(chatId: number, betId: string): Promise<Bet | undefined> {
        const [player, bet] = await Promise.all([
            this.deps.repos.players.byChat(chatId),
            this.deps.repos.bets.get(betId),
        ]);
        return player && bet?.playerId === player.id ? bet : undefined;
    }
}

function settleKeyboard(betId: string): Keyboard {
    return [
        [
            { text: "✅ Won", data: `st:${betId}:w` },
            { text: "❌ Lost", data: `st:${betId}:l` },
        ],
        [
            { text: "↩️ Void", data: `st:${betId}:v` },
            { text: "💰 Cashed out", data: `st:${betId}:c` },
        ],
    ];
}

function statusIcon(status: string): string {
    return { won: "✅", lost: "❌", void: "↩️", cashed_out: "💰" }[status] ?? "";
}
