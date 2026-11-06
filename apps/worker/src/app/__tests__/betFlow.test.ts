import { parseConfig } from "@closing-line/config";
import { createRepositories, openDatabase, type DatabaseHandle, type Repositories } from "@closing-line/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { silentLogger } from "../../lib/logger.ts";
import { BetFlow } from "../betFlow.ts";
import { Bettors } from "../bettors.ts";
import type { Reply } from "../chat.ts";

const OWNER = 100;
const FRIEND = 200;
const config = parseConfig({
    ODDS_API_KEY: "k",
    FOOTBALL_DATA_TOKEN: "t",
    TELEGRAM_BOT_TOKEN: "1:a",
    TELEGRAM_OWNER_CHAT_ID: String(OWNER),
});

let handle: DatabaseHandle;
let repos: Repositories;
let sent: { chatId: number; reply: Reply }[];
let clock: Date;
let bettors: Bettors;
let flow: BetFlow;

beforeAll(async () => {
    handle = await openDatabase({ kind: "pglite" });
    repos = createRepositories(handle.db);
});

afterAll(async () => {
    await handle.close();
});

beforeEach(async () => {
    await handle.db.execute("truncate players, fixtures, bets, chat_sessions restart identity cascade");
    sent = [];
    clock = new Date("2026-11-08T14:15:00Z");
    restart();
});

/** New flows on the same database, as after a restart. */
function restart(): void {
    const messenger = {
        send: (chatId: number, reply: Reply) => {
            sent.push({ chatId, reply });
            return Promise.resolve();
        },
    };
    bettors = new Bettors({ repos, config, messenger, now: () => clock });
    flow = new BetFlow({ repos, bettors, config, messenger, logger: silentLogger, now: () => clock });
}

/** The callback data of the first button whose label contains `label`. */
function button(reply: Reply | undefined, label: string): string {
    const found = reply?.keyboard?.flat().find((candidate) => candidate.text.includes(label));
    if (!found) throw new Error(`no ${label} button in ${JSON.stringify(reply)}`);
    return found.data;
}

async function letFriendIn(): Promise<void> {
    await bettors.start(FRIEND, "Sam");
    await bettors.tap(OWNER, button(sent[0]?.reply, "Allow"));
}

/** Answers one question with a tap on the button labelled `label`. */
function tap(reply: Reply | undefined, label: string, chatId = FRIEND): Promise<Reply> {
    return flow.tap(chatId, button(reply, label));
}

/** Answers one question with typed text. */
async function type(text: string, chatId = FRIEND): Promise<Reply> {
    const [reply] = await flow.text(chatId, text);
    if (!reply) throw new Error("no reply");
    return reply;
}

describe("strangers", () => {
    it("explains the wait while a join request is open, and says nothing to others", async () => {
        await bettors.start(FRIEND, "Sam");
        expect((await flow.bet(FRIEND)).text).toMatch(/^Still waiting/);
        expect((await flow.text(FRIEND, "hello"))[0]?.text).toMatch(/^Still waiting/);
        expect((await flow.bet(300)).text).toBe("Send /start first.");
        expect(await flow.text(300, "hello")).toEqual([]);
    });
});

describe("logging a bet step by step", () => {
    it("asks one question at a time and logs a complete player-prop bet", async () => {
        await letFriendIn();
        const sport = await flow.bet(FRIEND);
        expect(sport.text).toBe("New bet. Which sport?");
        const match = await tap(sport, "Football");
        expect(match.text).toMatch(/^Which match\?/);
        const market = await type("Atalanta – Lazio");
        expect(market.text).toBe("Atalanta – Lazio\nWhich market?");
        const player = await tap(market, "Shots on target");
        expect(player.text).toMatch(/^Which player\?/);
        const pick = await type("De Ketelaere");
        expect(pick.text).toMatch(/^De Ketelaere, shots on target: which line\?/);
        const book = await tap(pick, "Over 1.5");
        expect(book.text).toMatch(/^Which bookmaker\?/);
        const odds = await tap(book, "Betano");
        expect(odds.text).toMatch(/^What odds/);
        expect((await type("four")).text).toBe("The odds as a number, e.g. 3.70");
        await type("4,05");
        expect((await type("lots")).text).toBe("The stake in kroner, e.g. 1500");
        const reason = await type("1.225 kr");
        expect(reason.text).toBe(
            "🧾 Betano · Atalanta – Lazio\nDe Ketelaere shots on target over 1.5\nOdds 4.05 · Stake 1,225 kr\n\n" +
                "Why did you take it? Tap a reason to log the bet.",
        );

        const logged = await tap(reason, "Skewed price");
        expect(logged.text).toContain("✅ Logged as 📈 Skewed price.");
        expect(await repos.bets.forPlayer(`tg_${FRIEND}`)).toMatchObject([
            {
                fixtureId: null,
                sport: "football",
                eventName: "Atalanta – Lazio",
                market: "player_shots_on_target",
                selection: "over",
                line: 1.5,
                playerName: "De Ketelaere",
                lockedOdds: 4.05,
                stakeOre: 122_500,
                bookmaker: "betano",
                tag: "skewed_price",
                selfReported: true,
                receivedAt: clock,
                status: "open",
            },
        ]);
        expect(sent.at(-1)).toMatchObject({
            chatId: OWNER,
            reply: { text: expect.stringMatching(/^📝 Sam logged:\n🧾 Betano · Atalanta – Lazio/) as string },
        });
        // The bet is done: its buttons do nothing more.
        expect((await tap(reason, "Lineup")).text).toMatch(/no longer open/);
    });

    it("takes a typed line, a typed bookmaker, and match results by team", async () => {
        expect((await type("Newcastle v Everton", OWNER)).text).toBe("Send /log to log a bet, or /open to settle one.");

        await tap(await flow.bet(OWNER), "Football", OWNER);
        let reply = await type("Newcastle v Everton", OWNER);
        await tap(reply, "Corners", OWNER);
        expect((await type("nine", OWNER)).text).toBe("Type the line like over 9.5 or under 2.5");
        await type("under 9,5", OWNER);
        await type("Expekt", OWNER);
        await type("1.90", OWNER);
        reply = await type("100", OWNER);
        expect(reply.text).toContain("🧾 Expekt · Newcastle v Everton\ncorners under 9.5");
        await tap(reply, "Game read", OWNER);

        await tap(await flow.bet(OWNER), "Football", OWNER);
        reply = await type("Newcastle v Everton", OWNER);
        reply = await tap(reply, "Match result", OWNER);
        expect(reply.keyboard?.[0]?.map((each) => each.text)).toEqual(["Newcastle", "Draw", "Everton"]);
        reply = await tap(reply, "Newcastle", OWNER);
        await tap(reply, "NordicBet", OWNER);
        await type("2.25", OWNER);
        reply = await type("100", OWNER);
        expect(reply.text).toContain("Newcastle to win");
        await tap(reply, "Game read", OWNER);

        expect((await repos.bets.forPlayer("owner")).map((bet) => [bet.market, bet.selection, bet.line])).toEqual([
            ["corners", "under", 9.5],
            ["match_result", "home", null],
        ]);
        // The owner's own bets send no note to the owner.
        expect(sent).toEqual([]);
    });

    it("offers Counter-Strike winners by team, and a typed pick for other markets", async () => {
        await tap(await flow.bet(OWNER), "Counter-Strike", OWNER);
        let reply = await type("Aurora vs Team Liquid", OWNER);
        expect(reply.keyboard?.flat().map((each) => each.text)).toEqual(["Winner", "Other", "✖ Cancel"]);
        reply = await tap(reply, "Winner", OWNER);
        reply = await tap(reply, "Team Liquid", OWNER);
        await tap(reply, "Bet25", OWNER);
        await type("3.25", OWNER);
        reply = await type("2400", OWNER);
        expect(reply.text).toContain("Team Liquid to win");

        await tap(await flow.bet(OWNER), "Football", OWNER);
        reply = await type("Bayern – Dortmund", OWNER);
        reply = await tap(reply, "Other", OWNER);
        expect(reply.text).toBe("What did you back? Type it.");
        expect((await type("x", OWNER)).text).toBe("What did you back?");
        expect((await type("Both teams to score", OWNER)).text).toMatch(/^Which bookmaker\?/);
    });

    it("re-asks on wrong input, cancels, and forgets a bet left for an hour", async () => {
        await letFriendIn();
        let reply = await flow.bet(FRIEND);
        expect((await type("hi")).text).toBe("Tap one of the buttons above, or send /log to start again.");
        expect((await flow.tap(FRIEND, "w:tennis")).text).toBe("New bet. Which sport?");
        await tap(reply, "Football");
        expect((await type("ab")).text).toBe("Which match? E.g. Bayern v Arsenal");
        reply = await type("Ajax – PSV");
        await tap(reply, "Fouls");
        expect((await type("x")).text).toBe("Which player? E.g. Davies");
        expect(flow.owns("z:1")).toBe(false);
        expect((await flow.tap(FRIEND, "z:1")).text).toBe("Unknown button.");
        expect((await flow.tap(FRIEND, "x")).text).toBe("Cancelled. /log starts a new one.");
        expect((await type("Ajax")).text).toBe("Send /log to log a bet, or /open to settle one.");

        await tap(await flow.bet(FRIEND), "Football");
        clock = new Date(clock.getTime() + 61 * 60_000);
        expect((await flow.tap(FRIEND, "w:x")).text).toMatch(/no longer open/);
        expect(await repos.bets.forPlayer(`tg_${FRIEND}`)).toEqual([]);
    });

    it("asks for the bookmaker again when typed too short, and notes stakes above the cap", async () => {
        await tap(await flow.bet(OWNER), "Football", OWNER);
        let reply = await type("Ajax – PSV", OWNER);
        await tap(reply, "Shots", OWNER);
        reply = await type("Pavlidis", OWNER);
        reply = await tap(reply, "Over 2.5", OWNER);
        expect((await type("x", OWNER)).text).toBe("Which bookmaker?");
        await tap(reply, "ComeOn", OWNER);
        await type("5", OWNER);
        reply = await type("4000", OWNER);
        expect((await tap(reply, "Lineup", OWNER)).text).toContain("Note: the stake is above the 3,000 kr cap.");
    });
});

describe("matches we track", () => {
    const fixture = {
        id: "f".repeat(32),
        league: "soccer_germany_bundesliga",
        homeTeam: "Bayern Munich",
        awayTeam: "Borussia Dortmund",
    };

    beforeEach(async () => {
        await repos.fixtures.upsert([{ ...fixture, kickoff: new Date(clock.getTime() + 3 * 3_600_000) }]);
    });

    it("links a typed match to the fixture and stores a match result like the scanner's", async () => {
        await letFriendIn();
        await tap(await flow.bet(FRIEND), "Football");
        const market = await type("Bayern – Dortmund");
        expect(market.text).toBe(
            "✓ Kickoff Sun 18:15; a match-result bet gets a closing price.\nBayern Munich v Borussia Dortmund\nWhich market?",
        );
        const pick = await tap(market, "Match result");
        const book = await tap(pick, "Bayern Munich");
        await tap(book, "NordicBet");
        await type("1.85");
        await tap(await type("2000"), "Game read");
        expect(await repos.bets.forPlayer(`tg_${FRIEND}`)).toMatchObject([
            {
                fixtureId: fixture.id,
                eventName: "Bayern Munich v Borussia Dortmund",
                market: "h2h",
                selection: "home",
                lockedOdds: 1.85,
            },
        ]);
    });

    it("links a player prop too but keeps its market, and leaves unknown matches unlinked", async () => {
        await tap(await flow.bet(OWNER), "Football", OWNER);
        await tap(await type("bayern v dortmund", OWNER), "Shots on target", OWNER);
        let reply = await tap(await type("Kane", OWNER), "Over 0.5", OWNER);
        await tap(reply, "Bet25", OWNER);
        await type("1.4", OWNER);
        await tap(await type("500", OWNER), "Lineup", OWNER);

        await tap(await flow.bet(OWNER), "Football", OWNER);
        reply = await type("Ajax – PSV", OWNER);
        expect(reply.text).toBe("Ajax – PSV\nWhich market?");
        reply = await tap(reply, "Match result", OWNER);
        reply = await tap(reply, "Ajax", OWNER);
        await tap(reply, "Bet25", OWNER);
        await type("2.1", OWNER);
        await tap(await type("500", OWNER), "Lineup", OWNER);

        const bets = await repos.bets.forPlayer("owner");
        expect(bets.map((bet) => [bet.fixtureId, bet.market, bet.selection])).toEqual([
            [fixture.id, "player_shots_on_target", "over"],
            [null, "match_result", "home"],
        ]);
    });
});

describe("from a tip", () => {
    const fixtureId = "f".repeat(32);

    beforeEach(async () => {
        await repos.fixtures.upsert([
            {
                id: fixtureId,
                league: "soccer_efl_champ",
                homeTeam: "Hull City",
                awayTeam: "Watford",
                kickoff: new Date(clock.getTime() + 24 * 3_600_000),
            },
        ]);
        await letFriendIn();
    });

    it("fills in everything but the stake, as a new message, and logs it as a value tip", async () => {
        const odds = await flow.tap(FRIEND, `tb:${fixtureId}:away:nordicbet:3.25`);
        expect(odds).toMatchObject({
            text: "Hull City v Watford\nDid you get 3.25? Tap it, or type the odds you got.",
            newMessage: true,
        });
        expect((await tap(odds, "3.25")).text).toMatch(/^How much did you stake/);
        const logged = await type("1500");
        expect(logged.text).toBe(
            "🧾 NordicBet · Hull City v Watford\nWatford to win\nOdds 3.25 · Stake 1,500 kr\n\n✅ Logged as 🔎 Value tip.\n/log logs another.",
        );
        expect(await repos.bets.forPlayer(`tg_${FRIEND}`)).toMatchObject([
            { fixtureId, market: "h2h", selection: "away", bookmaker: "nordicbet", lockedOdds: 3.25, tag: "value_tip" },
        ]);
        expect(await repos.chats.get(FRIEND, "bet_draft")).toBeUndefined();
    });

    it("takes the odds the bettor typed, and does not log the same tip twice", async () => {
        await flow.tap(FRIEND, `tb:${fixtureId}:away:nordicbet:3.25`);
        await type("3.1");
        await type("1000");
        expect((await repos.bets.forPlayer(`tg_${FRIEND}`))[0]?.lockedOdds).toBe(3.1);
        expect((await flow.tap(FRIEND, `tb:${fixtureId}:away:unibet_se:3.40`)).text).toMatch(/Already logged\./);
    });

    it("refuses strangers and tips it cannot read", async () => {
        expect((await flow.tap(300, `tb:${fixtureId}:away:nordicbet:3.25`)).text).toBe("Send /start first.");
        expect((await flow.tap(FRIEND, `tb:${"e".repeat(32)}:away:nordicbet:3.25`)).text).toMatch(
            /no longer be logged/,
        );
        expect((await flow.tap(FRIEND, `tb:${fixtureId}:over:nordicbet:3.25`)).text).toMatch(/no longer be logged/);
    });
});

describe("undo and twins", () => {
    /** Logs Ajax – PSV, over 2.5 corners at Bet25 2.00 for 500 kr. */
    async function logCorners(chatId = FRIEND): Promise<Reply> {
        await tap(await flow.bet(chatId), "Football", chatId);
        await tap(await type("Ajax – PSV", chatId), "Corners", chatId);
        await tap(await type("over 2.5", chatId), "Bet25", chatId);
        await type("2", chatId);
        return tap(await type("500", chatId), "Lineup", chatId);
    }

    beforeEach(async () => {
        await letFriendIn();
    });

    it("asks before logging the same bet twice in a day, and logs it on Yes", async () => {
        expect((await logCorners()).text).toContain("✅ Logged");
        const twin = await logCorners();
        expect(twin.text).toContain("You logged this exact bet at 15:15. Log it again?");
        expect(await repos.bets.forPlayer(`tg_${FRIEND}`)).toHaveLength(1);
        expect((await tap(twin, "second bet")).text).toContain("✅ Logged");
        expect(await repos.bets.forPlayer(`tg_${FRIEND}`)).toHaveLength(2);

        clock = new Date(clock.getTime() + 25 * 3_600_000);
        expect((await logCorners()).text).toContain("✅ Logged");
    });

    it("deletes the last bet logged on /undo, tells the owner, and keeps it on Keep", async () => {
        expect((await flow.undo(FRIEND)).text).toBe("You have not logged a bet yet.");
        await logCorners();
        const asked = await flow.undo(FRIEND);
        expect(asked.text).toMatch(/Ajax – PSV[\s\S]*Delete this bet\?$/);
        expect((await tap(asked, "Keep")).text).toMatch(/^Kept\./);
        expect((await tap(asked, "Delete")).text).toContain("🗑 Deleted.");
        expect(await repos.bets.forPlayer(`tg_${FRIEND}`)).toEqual([]);
        expect(sent.at(-1)).toMatchObject({
            chatId: OWNER,
            reply: { text: expect.stringMatching(/^🗑 Sam deleted:/) as string },
        });
        expect((await tap(asked, "Delete")).text).toMatch(/already gone/);
    });

    it("keeps settled bets and refuses strangers", async () => {
        await logCorners();
        const [bet] = await repos.bets.forPlayer(`tg_${FRIEND}`);
        await repos.bets.settle(bet?.id ?? "", { status: "won", profitOre: 50_000, settledAt: clock });
        expect((await flow.undo(FRIEND)).text).toMatch(/settled, so it stays\.$/);
        expect((await flow.undo(300)).text).toBe("Send /start first.");
        expect((await flow.tap(300, `u:${bet?.id ?? ""}`)).text).toMatch(/nothing was deleted/);
    });
});

describe("restarts", () => {
    it("carries on with a bet half entered before a restart", async () => {
        await letFriendIn();
        await tap(await flow.bet(FRIEND), "Football");
        const asked = await type("Bayern – Arsenal");

        restart();
        const pick = await tap(asked, "Match result");
        expect(pick.text).toBe("Which result?");
        expect(button(pick, "Bayern")).toBe("w:home");
    });

    it("drops a stored draft it cannot read", async () => {
        await letFriendIn();
        await repos.chats.put(FRIEND, "bet_draft", { step: "toss", draft: {} }, clock);
        expect((await type("Bayern – Arsenal")).text).toBe("Send /log to log a bet, or /open to settle one.");
        expect(await repos.chats.get(FRIEND, "bet_draft")).toBeUndefined();
    });

    it("drops a stored draft with a market it no longer offers", async () => {
        await letFriendIn();
        const draft = { sport: "football", eventName: "Bayern v Arsenal", market: "player_tackles" };
        await repos.chats.put(FRIEND, "bet_draft", { step: "pick", draft }, clock);
        expect((await type("over 1.5")).text).toBe("Send /log to log a bet, or /open to settle one.");
    });

    it("will not log a stored draft that is missing an answer", async () => {
        await letFriendIn();
        const draft = { sport: "football", eventName: "Bayern v Arsenal", market: "match_result", selection: "home" };
        await repos.chats.put(FRIEND, "bet_draft", { step: "reason", draft }, clock);
        expect((await flow.tap(FRIEND, "t:g")).text).toBe("This bet is missing an answer. Send /log to start again.");
        expect(await repos.bets.listing(10)).toEqual([]);
        expect(await repos.chats.get(FRIEND, "bet_draft")).toBeUndefined();
    });
});
