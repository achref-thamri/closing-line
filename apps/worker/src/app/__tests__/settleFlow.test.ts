import {
    createRepositories,
    openDatabase,
    type DatabaseHandle,
    type NewBet,
    type Repositories,
} from "@closing-line/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { silentLogger } from "../../lib/logger.ts";
import type { SlipDraft } from "../../ports/slips.ts";
import type { Reply } from "../betFlow.ts";
import { parseKroner, SettleFlow } from "../settleFlow.ts";

const OWNER = 100;
const FRIEND = 200;
const now = new Date("2026-11-08T22:00:00Z");

let handle: DatabaseHandle;
let repos: Repositories;
let sent: { chatId: number; reply: Reply }[];
let flow: SettleFlow;

beforeAll(async () => {
    handle = await openDatabase({ kind: "pglite" });
    repos = createRepositories(handle.db);
});

afterAll(async () => {
    await handle.close();
});

beforeEach(async () => {
    await handle.db.execute("truncate players, bets restart identity cascade");
    await repos.players.ensure([
        { id: "friend", name: "Sam", kind: "bettor", startingBankrollOre: 6_000_000, telegramChatId: String(FRIEND) },
        { id: "owner", name: "Owner", kind: "bettor", startingBankrollOre: 6_000_000, telegramChatId: String(OWNER) },
    ]);
    sent = [];
    flow = new SettleFlow({
        repos,
        messenger: {
            send: (chatId, reply) => {
                sent.push({ chatId, reply });
                return Promise.resolve();
            },
        },
        ownerChatId: OWNER,
        logger: silentLogger,
        now: () => now,
    });
});

async function place(overrides: Partial<NewBet> = {}) {
    const bet = await repos.bets.place({
        playerId: "friend",
        eventName: "Milan – Inter",
        market: "player_shots_on_target",
        selection: "over",
        playerName: "Test Spiller",
        line: 1.5,
        stakeOre: 166_000,
        lockedOdds: 3.1,
        bookmaker: "bet25",
        selfReported: true,
        tag: "lineup",
        ...overrides,
    });
    if (!bet) throw new Error("not placed");
    return bet;
}

function button(reply: Reply | undefined, label: string): string {
    const found = reply?.keyboard?.flat().find((candidate) => candidate.text.includes(label));
    if (!found) throw new Error(`no ${label} button`);
    return found.data;
}

describe("/open", () => {
    it("lists open bets with settle buttons", async () => {
        await place();
        const [card] = await flow.open(FRIEND);
        expect(card?.text).toBe(
            "🧾 Bet25 · Milan – Inter\nTest Spiller shots on target over 1.5\nOdds 3.10 · Stake 1,660 kr\n\nHow did it end?",
        );
        expect(card?.keyboard?.flat().map((each) => each.text)).toEqual([
            "✅ Won",
            "❌ Lost",
            "↩️ Void",
            "💰 Cashed out",
        ]);
        expect(await flow.open(OWNER)).toEqual([{ text: "No open bets." }]);
        expect(await flow.open(999)).toEqual([{ text: "No open bets." }]);
    });
});

describe("settling with buttons", () => {
    it("settles won, lost and void, once, and tells the owner", async () => {
        const won = await place();
        const lost = await place({ line: 0.5 });
        const voided = await place({ line: 2.5 });
        const [wonCard, lostCard, voidCard] = await flow.open(FRIEND);

        expect((await flow.tap(FRIEND, button(wonCard, "Won"))).text).toMatch(/✅ won \+3,486 kr$/);
        expect((await flow.tap(FRIEND, button(lostCard, "Lost"))).text).toMatch(/❌ lost −1,660 kr$/);
        expect((await flow.tap(FRIEND, button(voidCard, "Void"))).text).toMatch(/↩️ void \+0 kr$/);
        expect((await flow.tap(FRIEND, button(wonCard, "Lost"))).text).toMatch(/Already settled\.$/);

        expect(await repos.bets.get(won.id)).toMatchObject({ status: "won", profitOre: 348_600, settledAt: now });
        expect(await repos.bets.get(lost.id)).toMatchObject({ status: "lost", profitOre: -166_000 });
        expect(await repos.bets.get(voided.id)).toMatchObject({ status: "void", profitOre: 0 });
        expect(sent.map(({ chatId, reply }) => [chatId, reply.text.split("\n")[0]])).toEqual([
            [OWNER, "📝 Sam settled:"],
            [OWNER, "📝 Sam settled:"],
            [OWNER, "📝 Sam settled:"],
        ]);
    });

    it("refuses other people's bets and unknown buttons", async () => {
        const bet = await place();
        expect((await flow.tap(OWNER, `st:${bet.id}:w`)).text).toBe("That bet is not yours or no longer exists.");
        expect((await flow.tap(FRIEND, `st:${bet.id}:x`)).text).toBe("Unknown button.");
        expect((await flow.tap(FRIEND, `hd:${bet.id}:w`)).text).not.toMatch(/Cashed out/);
    });
});

describe("cash-outs", () => {
    it("asks for the amount, records the price it implies, then compares with holding", async () => {
        const bet = await place();
        const [card] = await flow.open(FRIEND);
        expect((await flow.tap(FRIEND, button(card, "Cashed out"))).text).toMatch(/How much did the cash-out pay\?/);
        expect(await flow.amount(FRIEND, "about two thousand")).toEqual({
            text: "Reply with just the amount, e.g. 2557 or 2.557,17.",
        });

        const cashed = await flow.amount(FRIEND, "2.557,17 kr");
        expect(cashed?.text).toContain("💰 cashed out +897.17 kr");
        expect(cashed?.text).toContain("the price moved from 3.10 to about 2.01");
        const stored = await repos.bets.get(bet.id);
        expect(stored).toMatchObject({ status: "cashed_out", profitOre: 89_717, cashoutOfferOre: 255_717 });
        expect(stored?.impliedCurrentOdds).toBeCloseTo(2.012, 3);
        expect(stored?.clv).toBeCloseTo(0.5405, 4);

        const held = await flow.tap(FRIEND, button(cashed, "Would have won"));
        expect(held.text).toContain("It would have won. Holding would have paid 2,588.83 kr more.");
        expect((await repos.bets.get(bet.id))?.heldStatus).toBe("won");
        expect((await flow.tap(FRIEND, `hd:${bet.id}:l`)).text).toContain(
            "Cashing out paid 2,557.17 kr more than holding.",
        );
        expect(await flow.amount(FRIEND, "100")).toBeUndefined();
    });

    it("does not settle twice when the amount arrives after the bet was settled", async () => {
        const bet = await place();
        await flow.tap(FRIEND, `st:${bet.id}:c`);
        await flow.tap(FRIEND, `st:${bet.id}:w`);
        expect(await flow.amount(FRIEND, "2557")).toEqual({ text: "That bet is already settled." });
    });
});

describe("settled slips", () => {
    const draft: SlipDraft = {
        bookmaker: "bet25",
        sport: "football",
        competition: null,
        eventName: "AC Milan - Inter Milan",
        market: "player_shots_on_target",
        marketText: "Skud på mål",
        playerName: "Test Spiller",
        selection: "over",
        line: 1.5,
        odds: 3.1,
        stakeOre: 166_000,
        couponId: null,
        placedAtLocal: null,
        status: "won",
        payoutOre: 514_600,
    };

    it("settles the matching open bet by odds, stake and line, or by coupon", async () => {
        const bet = await place();
        expect((await flow.fromSlip(FRIEND, draft))?.text).toMatch(/✅ won/);
        expect((await repos.bets.get(bet.id))?.status).toBe("won");

        const withCoupon = await place({ couponId: "c-9", lockedOdds: 2 });
        const cashed = await flow.fromSlip(FRIEND, {
            ...draft,
            couponId: "c-9",
            status: "cashed_out",
            payoutOre: 200_000,
        });
        expect(cashed?.text).toMatch(/💰 cashed out \+340 kr/);
        expect(await repos.bets.get(withCoupon.id)).toMatchObject({ status: "cashed_out", cashoutOfferOre: 200_000 });
    });

    it("leaves it alone when nothing or more than one bet matches, or the slip is open", async () => {
        expect(await flow.fromSlip(FRIEND, draft)).toBeUndefined();
        await place();
        await place({ couponId: "other" });
        await place();
        expect(await flow.fromSlip(FRIEND, draft)).toBeUndefined();
        expect(await flow.fromSlip(FRIEND, { ...draft, status: "open" })).toBeUndefined();
        expect(await flow.fromSlip(999, draft)).toBeUndefined();
        expect(await flow.fromSlip(FRIEND, { ...draft, status: "cashed_out", payoutOre: null })).toBeUndefined();
    });
});

describe("parseKroner", () => {
    it("reads Danish and English amounts", () => {
        expect(parseKroner("2557")).toBe(2557);
        expect(parseKroner("2.557,17 kr.")).toBe(2557.17);
        expect(parseKroner("2,557.17")).toBe(2557.17);
        expect(parseKroner("2.557")).toBe(2557);
        expect(parseKroner("12,5")).toBe(12.5);
        expect(parseKroner("1 500 DKK")).toBe(1500);
    });

    it("refuses anything that is not one amount", () => {
        expect(parseKroner("won")).toBeUndefined();
        expect(parseKroner("0")).toBeUndefined();
        expect(parseKroner("2557 and 100")).toBeUndefined();
    });
});
