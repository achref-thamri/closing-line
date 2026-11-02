import { parseConfig } from "@closing-line/config";
import { createRepositories, openDatabase, type DatabaseHandle, type Repositories } from "@closing-line/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { silentLogger } from "../../lib/logger.ts";
import type { SlipDraft } from "../../ports/slips.ts";
import { BetFlow, describe as describeDraft, type Reply } from "../betFlow.ts";

const OWNER = 100;
const FRIEND = 200;
const config = parseConfig({
    ODDS_API_KEY: "k",
    FOOTBALL_DATA_TOKEN: "t",
    TELEGRAM_BOT_TOKEN: "1:a",
    TELEGRAM_OWNER_CHAT_ID: String(OWNER),
});
const image = { data: Buffer.from("jpeg"), mediaType: "image/jpeg" } as const;

// A made-up open slip: a player prop the way the reader returns it.
const draft: SlipDraft = {
    bookmaker: "nordicbet",
    sport: "football",
    competition: "Premier League",
    eventName: "Brentford – Fulham",
    market: "player_shots_on_target",
    marketText: "Antal afslutninger på mål",
    playerName: "Test Spiller",
    selection: "over",
    line: 0.5,
    odds: 3.6,
    stakeOre: 125_000,
    couponId: "c-1",
    placedAtLocal: "2026-11-08T15:12",
    status: "open",
    payoutOre: 450_000,
};

let handle: DatabaseHandle;
let repos: Repositories;
let sent: { chatId: number; reply: Reply }[];
let drafts: SlipDraft[];
let typedTexts: string[];
let flow: BetFlow;

beforeAll(async () => {
    handle = await openDatabase({ kind: "pglite" });
    repos = createRepositories(handle.db);
});

afterAll(async () => {
    await handle.close();
});

beforeEach(async () => {
    await handle.db.execute("truncate players, bets restart identity cascade");
    sent = [];
    drafts = [draft];
    typedTexts = [];
    flow = new BetFlow({
        reader: {
            read: () => Promise.resolve(drafts),
            readText: (text) => {
                typedTexts.push(text);
                return Promise.resolve(drafts);
            },
        },
        repos,
        config,
        messenger: {
            send: (chatId, reply) => {
                sent.push({ chatId, reply });
                return Promise.resolve();
            },
        },
        saveScreenshot: () => Promise.resolve("/data/slips/2026-11-08/1.jpeg"),
        logger: silentLogger,
        now: () => new Date("2026-11-08T14:15:00Z"),
    });
});

/** The callback data of the first button whose label contains `label`. */
function button(reply: Reply | undefined, label: string): string {
    const found = reply?.keyboard?.flat().find((candidate) => candidate.text.includes(label));
    if (!found) throw new Error(`no ${label} button`);
    return found.data;
}

async function letFriendIn(): Promise<void> {
    await flow.start(FRIEND, "Sam");
    await flow.tap(OWNER, button(sent[0]?.reply, "Allow"));
}

describe("access", () => {
    it("asks the owner about a stranger and lets them in on Allow", async () => {
        expect((await flow.start(FRIEND, "Sam")).text).toMatch(/owner has been asked/);
        expect(sent[0]).toMatchObject({ chatId: OWNER, reply: { text: "Sam wants to log bets with Closing Line." } });
        expect(await flow.isAllowed(FRIEND)).toBe(false);
        // While waiting: a second /start does not ask the owner again, and bets get an explanation.
        expect((await flow.start(FRIEND, "Sam")).text).toMatch(/^Still waiting/);
        expect((await flow.typed(FRIEND, "Davies over 0.5 at 3.70, 1500 kr"))[0]?.text).toMatch(/^Still waiting/);
        expect((await flow.slip(FRIEND, image))[0]?.text).toMatch(/^Still waiting/);
        expect(sent).toHaveLength(1);

        expect((await flow.tap(OWNER, button(sent[0]?.reply, "Allow"))).text).toBe("Sam can now log bets.");
        expect(sent[1]).toMatchObject({
            chatId: FRIEND,
            reply: { text: expect.stringMatching(/^You're in!/) as string },
        });
        expect(await repos.players.byChat(FRIEND)).toMatchObject({
            id: `tg_${FRIEND}`,
            name: "Sam",
            kind: "human",
            startingBankrollOre: 6_000_000,
        });
        expect((await flow.start(FRIEND, "Sam")).text).toMatch(/^Send a screenshot/);
    });

    it("keeps a stranger out on Deny, and only the owner decides", async () => {
        await flow.start(FRIEND, "Sam");
        const allow = button(sent[0]?.reply, "Allow");
        expect((await flow.tap(FRIEND, allow)).text).toBe("Only the owner can decide.");
        expect((await flow.tap(OWNER, button(sent[0]?.reply, "Deny"))).text).toBe("Sam was not let in.");
        expect(await flow.isAllowed(FRIEND)).toBe(false);
        expect(await flow.slip(FRIEND, image)).toEqual([{ text: "Send /start first." }]);
    });
});

describe("logging a bet from a slip", () => {
    it("shows a card and logs the bet with the tapped reason", async () => {
        await letFriendIn();
        const [card] = await flow.slip(FRIEND, image);
        expect(card?.text).toContain("Test Spiller shots on target over 0.5");
        expect(card?.text).toContain("Odds 3.60 · Stake 1,250 kr");

        const logged = await flow.tap(FRIEND, button(card, "Lineup"));
        expect(logged.text).toContain("✅ Logged as ⚡ Lineup.");
        expect(await repos.bets.forPlayer(`tg_${FRIEND}`)).toMatchObject([
            {
                fixtureId: null,
                eventName: "Brentford – Fulham",
                market: "player_shots_on_target",
                selection: "over",
                line: 0.5,
                playerName: "Test Spiller",
                lockedOdds: 3.6,
                stakeOre: 125_000,
                bookmaker: "nordicbet",
                couponId: "c-1",
                tag: "lineup",
                selfReported: true,
                placedAt: new Date("2026-11-08T14:12:00Z"),
                receivedAt: new Date("2026-11-08T14:15:00Z"),
                screenshotPath: "/data/slips/2026-11-08/1.jpeg",
                status: "open",
            },
        ]);

        // The card is spent; a second tap and a resent slip do not log the bet twice.
        expect((await flow.tap(FRIEND, button(card, "Lineup"))).text).toMatch(/expired/);
        const [again] = await flow.slip(FRIEND, image);
        expect((await flow.tap(FRIEND, button(again, "Game read"))).text).toContain("Already logged.");
    });

    it("lets the owner log bets without being approved", async () => {
        const [card] = await flow.slip(OWNER, image);
        await flow.tap(OWNER, button(card, "Game read"));
        expect(await repos.bets.forPlayer("owner")).toHaveLength(1);
    });

    it("refuses settled slips", async () => {
        await letFriendIn();
        drafts = [
            { ...draft, status: "won" },
            { ...draft, status: "cashed_out" },
        ];
        const cards = await flow.slip(FRIEND, image);
        expect(cards.map((card) => card.keyboard)).toEqual([undefined, undefined]);
        expect(cards[1]?.text).toContain("Already cashed out, so not logged");
    });

    it("asks for the bookmaker when the slip shows none", async () => {
        await letFriendIn();
        drafts = [{ ...draft, bookmaker: "unknown" }];
        const [card] = await flow.slip(FRIEND, image);
        expect(card?.text).toContain("Bookmaker? Tap it below");
        const picked = await flow.tap(FRIEND, button(card, "Danske Spil"));
        expect(picked.text).toContain("🧾 Danske Spil ·");
        await flow.tap(FRIEND, button(picked, "Skewed"));
        expect(await repos.bets.forPlayer(`tg_${FRIEND}`)).toMatchObject([
            { bookmaker: "danske_spil", tag: "skewed_price" },
        ]);
    });

    it("discards a card, and only its sender can tap it", async () => {
        await letFriendIn();
        const [card] = await flow.slip(FRIEND, image);
        expect((await flow.tap(OWNER, button(card, "Lineup"))).text).toMatch(/expired/);
        expect((await flow.tap(FRIEND, button(card, "Discard"))).text).toContain("Discarded.");
        expect(await repos.bets.forPlayer(`tg_${FRIEND}`)).toEqual([]);
    });

    it("says so when the screenshot has no bet, and notes stakes above the cap", async () => {
        await letFriendIn();
        drafts = [];
        expect((await flow.slip(FRIEND, image))[0]?.text).toMatch(/could not find a bet/);
        drafts = [{ ...draft, stakeOre: 400_000 }];
        const [card] = await flow.slip(FRIEND, image);
        expect((await flow.tap(FRIEND, button(card, "Lineup"))).text).toContain("above the 3,000 kr cap");
    });
});

describe("typed bets", () => {
    it("logs a typed bet without a screenshot", async () => {
        await letFriendIn();
        drafts = [{ ...draft, couponId: null, placedAtLocal: null }];
        const [card] = await flow.typed(
            FRIEND,
            "Test Spiller over 0.5 shots on target, Brentford–Fulham, NordicBet, 3.60, 1250 kr",
        );
        expect(card?.text).toContain("✍️ Typed, no screenshot");
        await flow.tap(FRIEND, button(card, "Game read"));
        expect(await repos.bets.forPlayer(`tg_${FRIEND}`)).toMatchObject([
            { screenshotPath: null, couponId: null, placedAt: null, tag: "game_read", selfReported: true },
        ]);
    });

    it("answers chat without asking Claude, and ignores strangers", async () => {
        await letFriendIn();
        expect((await flow.typed(FRIEND, "hi there"))[0]?.text).toMatch(
            /^Send a screenshot of the slip, or type the bet/,
        );
        expect(await flow.typed(300, "Davies over 0.5 at 3.70")).toEqual([]);
        drafts = [];
        expect((await flow.typed(FRIEND, "back at 7"))[0]?.text).toMatch(/^I could not find a bet in that/);
        expect(typedTexts).toEqual(["back at 7"]);
    });
});

describe("card text", () => {
    it("names the backed side for winner markets", () => {
        expect(
            describeDraft({
                ...draft,
                sport: "counter_strike",
                eventName: "Team A – Team B",
                competition: null,
                market: "match_winner",
                selection: "Team B",
                playerName: null,
                line: null,
                placedAtLocal: null,
            }),
        ).toBe("🧾 Nordicbet · Team A – Team B\nTeam B winner\nOdds 3.60 · Stake 1,250 kr");
    });
});
