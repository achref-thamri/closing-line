import { heldProfitOre, impliedOddsFromCashout, priceMove } from "@closing-line/core";
import type { Bet, Repositories } from "@closing-line/db";
import type { Logger } from "../lib/logger.ts";
import type { SlipDraft } from "../ports/slips.ts";
import { bookName, kroner, pickText, type Keyboard, type Messenger, type Reply } from "./betFlow.ts";

type Outcome = "won" | "lost" | "void";
interface SlipSettlement {
    status: Outcome | "cashed_out";
    profitOre: number;
    cashoutOfferOre?: number;
    impliedCurrentOdds?: number;
    clv?: number;
}
const OUTCOME_KEYS: Record<string, Outcome> = { w: "won", l: "lost", v: "void" };

export interface SettleFlowDeps {
    repos: Pick<Repositories, "players" | "bets">;
    messenger: Messenger;
    ownerChatId: number;
    logger: Logger;
    now?: () => Date;
}

/**
 * Settling bettors' bets (spec §4): `/open` lists them with Won / Lost / Void / Cashed out buttons; a cash-out asks
 * for the amount, records the price it implies, then asks how the bet would have ended. A settled slip whose bet
 * is still open settles it directly.
 */
export class SettleFlow {
    private readonly deps: SettleFlowDeps;
    private readonly now: () => Date;
    /** Chats asked for a cash-out amount, and for which bet. */
    private readonly awaitingAmount = new Map<number, string>();

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

    /** Buttons `st:<bet>:<w|l|v|c>` and `hd:<bet>:<w|l|v>`. */
    async tap(chatId: number, data: string): Promise<Reply> {
        const [action, betId = "", key = ""] = data.split(":");
        const bet = await this.ownBet(chatId, betId);
        if (!bet) return { text: "That bet is not yours or no longer exists." };

        if (action === "hd") {
            const held = OUTCOME_KEYS[key];
            if (!held || bet.status !== "cashed_out") return { text: describeBet(bet) };
            await this.deps.repos.bets.setHeldStatus(bet.id, held);
            const gain = (bet.cashoutOfferOre ?? 0) - bet.stakeOre - heldProfitOre(bet, held);
            const verdict =
                gain >= 0
                    ? `Cashing out paid ${kroner(gain)} more than holding.`
                    : `Holding would have paid ${kroner(-gain)} more.`;
            return { text: `${describeBet(bet)}\n\n💰 Cashed out. It would have ${held}. ${verdict}` };
        }

        if (bet.status !== "open") return { text: `${describeBet(bet)}\n\nAlready settled.` };
        if (key === "c") {
            this.awaitingAmount.set(chatId, bet.id);
            return { text: `${describeBet(bet)}\n\nHow much did the cash-out pay? Reply with the amount, e.g. 2557.` };
        }
        const outcome = OUTCOME_KEYS[key];
        if (action !== "st" || !outcome) return { text: "Unknown button." };
        return this.settle(chatId, bet, { status: outcome, profitOre: heldProfitOre(bet, outcome) });
    }

    /** A text reply while a cash-out amount is awaited; undefined when none is, so the text is a bet instead. */
    async amount(chatId: number, text: string): Promise<Reply | undefined> {
        const betId = this.awaitingAmount.get(chatId);
        if (betId === undefined) return undefined;
        const kroner = parseKroner(text);
        if (kroner === undefined) return { text: "Reply with just the amount, e.g. 2557 or 2.557,17." };
        this.awaitingAmount.delete(chatId);
        const bet = await this.ownBet(chatId, betId);
        if (bet?.status !== "open") return { text: "That bet is already settled." };
        return this.cashOut(chatId, bet, Math.round(kroner * 100));
    }

    /** A settled slip (won, lost, void or cashed out) for a bet still open: settles it. */
    async fromSlip(chatId: number, draft: SlipDraft): Promise<Reply | undefined> {
        if (draft.status === "open") return undefined;
        const player = await this.deps.repos.players.byChat(chatId);
        if (!player) return undefined;
        const matches = (await this.deps.repos.bets.openFor(player.id)).filter((bet) => sameBet(bet, draft));
        const [bet] = matches;
        if (!bet || matches.length > 1) return undefined;
        if (draft.status === "cashed_out") {
            if (draft.payoutOre === null) return undefined;
            return this.cashOut(chatId, bet, draft.payoutOre);
        }
        return this.settle(chatId, bet, { status: draft.status, profitOre: heldProfitOre(bet, draft.status) });
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
        const done = await this.deps.repos.bets.settleSlip(bet.id, { ...settlement, settledAt: this.now() });
        if (!done) return { text: `${describeBet(bet)}\n\nAlready settled.` };
        const result = `${statusIcon(settlement.status)} ${settlement.status.replace("_", " ")} ${signed(settlement.profitOre)}`;
        if (chatId !== this.deps.ownerChatId) {
            const name = (await this.deps.repos.players.byChat(chatId))?.name ?? bet.playerId;
            await this.deps.messenger.send(this.deps.ownerChatId, {
                text: `📝 ${name} settled:\n${describeBet(bet)}\n${result}`,
            });
        }
        this.deps.logger.info({ playerId: bet.playerId, status: settlement.status }, "slip bet settled");
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

export function describeBet(bet: Bet): string {
    return [
        `🧾 ${bookName(bet.bookmaker)} · ${bet.eventName ?? ""}`.trim(),
        pickText(bet),
        `Odds ${bet.lockedOdds.toFixed(2)} · Stake ${kroner(bet.stakeOre)}`,
    ].join("\n");
}

/** The same bet on a settled slip: the same coupon, or the same odds, stake and line. */
function sameBet(bet: Bet, draft: SlipDraft): boolean {
    if (bet.couponId && draft.couponId) return bet.couponId === draft.couponId && bet.line === draft.line;
    return bet.lockedOdds === draft.odds && bet.stakeOre === draft.stakeOre && bet.line === draft.line;
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

function statusIcon(status: string): string {
    return { won: "✅", lost: "❌", void: "↩️", cashed_out: "💰" }[status] ?? "";
}

function signed(ore: number): string {
    return `${ore >= 0 ? "+" : "−"}${kroner(Math.abs(ore))}`;
}
