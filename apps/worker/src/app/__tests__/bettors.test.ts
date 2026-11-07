import { parseConfig } from "@closing-line/config";
import { createRepositories, openDatabase, type DatabaseHandle, type Repositories } from "@closing-line/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
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

beforeAll(async () => {
    handle = await openDatabase({ kind: "pglite" });
    repos = createRepositories(handle.db);
});

afterAll(async () => {
    await handle.close();
});

beforeEach(async () => {
    await handle.db.execute("truncate players, bets, chat_sessions restart identity cascade");
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

describe("access", () => {
    it("asks the owner about a stranger and lets them in on Allow", async () => {
        expect((await bettors.start(FRIEND, "Sam")).text).toMatch(/owner has been asked/);
        expect(sent[0]).toMatchObject({ chatId: OWNER, reply: { text: "Sam wants to log bets with Closing Line." } });
        expect(await bettors.isAllowed(FRIEND)).toBe(false);
        // While waiting, a second /start does not ask the owner again.
        expect(await bettors.isWaiting(FRIEND)).toBe(true);
        expect((await bettors.start(FRIEND, "Sam")).text).toMatch(/^Still waiting/);
        expect(sent).toHaveLength(1);

        expect((await bettors.tap(OWNER, button(sent[0]?.reply, "Allow"))).text).toBe("Sam can now log bets.");
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
        expect((await bettors.start(FRIEND, "Sam")).text).toMatch(/^Send \/log right after placing a bet/);
    });

    it("keeps a stranger out on Deny, and only the owner decides", async () => {
        await bettors.start(FRIEND, "Sam");
        const allow = button(sent[0]?.reply, "Allow");
        expect((await bettors.tap(FRIEND, allow)).text).toBe("Only the owner can decide.");
        expect((await bettors.tap(OWNER, button(sent[0]?.reply, "Deny"))).text).toBe("Sam was not let in.");
        expect(await bettors.isAllowed(FRIEND)).toBe(false);
        expect(await bettors.isWaiting(FRIEND)).toBe(false);
    });
});

describe("tip settings", () => {
    it("turns tips off and on for a person", async () => {
        await letFriendIn();
        expect((await bettors.tips(FRIEND, "Sam", "")).text).toBe("Value tips are on. Send /tips on or /tips off.");
        expect((await bettors.tips(FRIEND, "Sam", "off")).text).toMatch(/^Value tips are off/);
        expect(await repos.players.byChat(FRIEND)).toMatchObject({ tipsMuted: true });
        expect((await bettors.tips(FRIEND, "Sam", "")).text).toMatch(/^Value tips are off\./);
        expect((await bettors.tips(FRIEND, "Sam", "ON")).text).toBe("Value tips are on.");
        expect(await repos.players.byChat(FRIEND)).toMatchObject({ tipsMuted: false });
        expect((await bettors.tips(300, "Stranger", "off")).text).toBe("Send /start first.");
    });

    it("keeps the owner's player named Owner", async () => {
        await bettors.tips(OWNER, "Owner", "off");
        expect(await repos.players.byChat(OWNER)).toMatchObject({ id: "owner", name: "Owner", tipsMuted: true });
    });
});

describe("restarts", () => {
    it("remembers a join request across a restart", async () => {
        await bettors.start(FRIEND, "Sam");
        restart();
        expect((await bettors.start(FRIEND, "Sam")).text).toMatch(/^Still waiting/);
        expect((await bettors.tap(OWNER, button(sent[0]?.reply, "Allow"))).text).toBe("Sam can now log bets.");
    });
});

describe("buttons", () => {
    it("owns Allow and Deny only", () => {
        expect(bettors.owns("ap:200")).toBe(true);
        expect(bettors.owns("dn:200")).toBe(true);
        expect(bettors.owns("st:b:w")).toBe(false);
    });
});
