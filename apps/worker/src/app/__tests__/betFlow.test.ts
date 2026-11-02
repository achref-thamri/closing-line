import { parseConfig } from "@closing-line/config";
import { createRepositories, openDatabase, type DatabaseHandle, type Repositories } from "@closing-line/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { silentLogger } from "../../lib/logger.ts";
import { BetFlow, parseDecimal, pickText, teamsOf, type Reply } from "../betFlow.ts";

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
    clock = new Date("2026-11-08T14:15:00Z");
    flow = new BetFlow({
        repos,
        config,
        messenger: {
            send: (chatId, reply) => {
                sent.push({ chatId, reply });
                return Promise.resolve();
            },
        },
        logger: silentLogger,
        now: () => clock,
    });
});

/** The callback data of the first button whose label contains `label`. */
function button(reply: Reply | undefined, label: string): string {
    const found = reply?.keyboard?.flat().find((candidate) => candidate.text.includes(label));
    if (!found) throw new Error(`no ${label} button in ${JSON.stringify(reply)}`);
    return found.data;
}

async function letFriendIn(): Promise<void> {
    await flow.start(FRIEND, "Sam");
    await flow.tap(OWNER, button(sent[0]?.reply, "Allow"));
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

describe("access", () => {
    it("asks the owner about a stranger and lets them in on Allow", async () => {
        expect((await flow.start(FRIEND, "Sam")).text).toMatch(/owner has been asked/);
        expect(sent[0]).toMatchObject({ chatId: OWNER, reply: { text: "Sam wants to log bets with Closing Line." } });
        expect(await flow.isAllowed(FRIEND)).toBe(false);
        // While waiting: a second /start does not ask the owner again, and bets get an explanation.
        expect((await flow.start(FRIEND, "Sam")).text).toMatch(/^Still waiting/);
        expect((await flow.bet(FRIEND)).text).toMatch(/^Still waiting/);
        expect((await flow.text(FRIEND, "hello"))[0]?.text).toMatch(/^Still waiting/);
        expect(sent).toHaveLength(1);

        expect((await flow.tap(OWNER, button(sent[0]?.reply, "Allow"))).text).toBe("Sam can now log bets.");
        expect(sent[1]).toMatchObject({
            chatId: FRIEND,
            reply: { text: expect.stringMatching(/^You're in!/) as string },
        });
        expect(await repos.players.byChat(FRIEND)).toMatchObject({
            id: `tg_${FRIEND}`,
            name: "Sam",
            kind: "bettor",
            startingBankrollOre: 6_000_000,
        });
        expect((await flow.start(FRIEND, "Sam")).text).toMatch(/^Send \/log right after placing a bet/);
    });

    it("keeps a stranger out on Deny, and only the owner decides", async () => {
        await flow.start(FRIEND, "Sam");
        const allow = button(sent[0]?.reply, "Allow");
        expect((await flow.tap(FRIEND, allow)).text).toBe("Only the owner can decide.");
        expect((await flow.tap(OWNER, button(sent[0]?.reply, "Deny"))).text).toBe("Sam was not let in.");
        expect(await flow.isAllowed(FRIEND)).toBe(false);
        expect((await flow.bet(FRIEND)).text).toBe("Send /start first.");
        expect(await flow.text(FRIEND, "hello")).toEqual([]);
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
                screenshotPath: null,
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
        expect((await type("ab")).text).toBe("Which match? E.g. Bayern – Arsenal");
        reply = await type("Ajax – PSV");
        await tap(reply, "Fouls");
        expect((await type("x")).text).toBe("Which player? E.g. Davies");
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

describe("tip settings", () => {
    it("turns tips off and on for a person", async () => {
        await letFriendIn();
        expect((await flow.tips(FRIEND, "Sam", "")).text).toBe("Value tips are on. Send /tips on or /tips off.");
        expect((await flow.tips(FRIEND, "Sam", "off")).text).toMatch(/^Value tips are off/);
        expect(await repos.players.byChat(FRIEND)).toMatchObject({ tipsMuted: true });
        expect((await flow.tips(FRIEND, "Sam", "")).text).toMatch(/^Value tips are off\./);
        expect((await flow.tips(FRIEND, "Sam", "ON")).text).toBe("Value tips are on.");
        expect(await repos.players.byChat(FRIEND)).toMatchObject({ tipsMuted: false });
        expect((await flow.tips(300, "Stranger", "off")).text).toBe("Send /start first.");
    });

    it("keeps the owner's player named Owner", async () => {
        await flow.tips(OWNER, "Achref", "off");
        expect(await repos.players.byChat(OWNER)).toMatchObject({ id: "owner", name: "Owner", tipsMuted: true });
    });
});

describe("helpers", () => {
    it("splits matches into teams", () => {
        expect(teamsOf("Bayern – Arsenal")).toEqual(["Bayern", "Arsenal"]);
        expect(teamsOf("Newcastle v Everton")).toEqual(["Newcastle", "Everton"]);
        expect(teamsOf("Bayern-Dortmund")).toEqual(["Bayern", "Dortmund"]);
        expect(teamsOf("Bayern")).toEqual([]);
    });

    it("describes picks", () => {
        const base = { playerName: null, line: null, eventName: "Bayern – Arsenal" };
        expect(pickText({ ...base, market: "match_result", selection: "away" })).toBe("Arsenal to win");
        expect(pickText({ ...base, market: "match_result", selection: "draw" })).toBe("Draw");
        expect(pickText({ ...base, eventName: "?", market: "match_result", selection: "home" })).toBe("home");
        expect(pickText({ ...base, market: "other", selection: "Both teams to score" })).toBe("Both teams to score");
    });

    it("reads decimals with a point or a comma", () => {
        expect(parseDecimal("3,70")).toBe(3.7);
        expect(parseDecimal("3.7x")).toBeUndefined();
    });
});
