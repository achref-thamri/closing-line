import {
    createRepositories,
    openDatabase,
    type DatabaseHandle,
    type NewBet,
    type Repositories,
} from "@closing-line/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { silentLogger } from "../../lib/logger.ts";
import type { Reply } from "../chat.ts";
import { SettleFlow } from "../settleFlow.ts";

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
    await handle.db.execute("truncate players, bets, chat_sessions restart identity cascade");
    await repos.players.ensure([
        { id: "friend", name: "Sam", kind: "bettor", startingBankrollOre: 6_000_000, telegramChatId: String(FRIEND) },
        { id: "owner", name: "Owner", kind: "bettor", startingBankrollOre: 6_000_000, telegramChatId: String(OWNER) },
    ]);
    sent = [];
    flow = newFlow();
});

/** A fresh flow on the same database, as after a restart. */
function newFlow(): SettleFlow {
    return new SettleFlow({
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
}

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
        expect([flow.owns(`st:${bet.id}:w`), flow.owns(`hd:${bet.id}:w`), flow.owns("w:football")]).toEqual([
            true,
            true,
            false,
        ]);
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

describe("restarts", () => {
    it("still takes the cash-out amount after a restart", async () => {
        const bet = await place();
        await flow.tap(FRIEND, `st:${bet.id}:c`);
        flow = newFlow();
        expect((await flow.amount(FRIEND, "2557"))?.text).toContain("💰 cashed out");
        expect((await repos.bets.get(bet.id))?.status).toBe("cashed_out");
    });
});
