import { createRepositories, openDatabase, type DatabaseHandle, type Repositories } from "@closing-line/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { remindOpenBets } from "../reminders.ts";

let handle: DatabaseHandle;
let repos: Repositories;

beforeAll(async () => {
    handle = await openDatabase({ kind: "pglite" });
    repos = createRepositories(handle.db);
});

afterAll(async () => {
    await handle.close();
});

beforeEach(async () => {
    await handle.db.execute("truncate players, fixtures, bets, chat_sessions restart identity cascade");
    await repos.players.ensure([
        { id: "tg_2", name: "Sam", kind: "bettor", startingBankrollOre: 6_000_000, telegramChatId: "2" },
        { id: "owner", name: "Owner", kind: "bettor", startingBankrollOre: 6_000_000, telegramChatId: "1" },
        { id: "scanner", name: "Scanner", kind: "scanner", startingBankrollOre: 1_000_000 },
    ]);
});

function slipBet(playerId: string) {
    return repos.bets.place({
        playerId,
        eventName: "A – B",
        market: "player_shots_on_target",
        selection: "over",
        stakeOre: 100_000,
        lockedOdds: 3,
        bookmaker: "nordicbet",
        selfReported: true,
    });
}

describe("remindOpenBets", () => {
    it("nudges bettors whose bets have been open over 12 hours", async () => {
        await slipBet("tg_2");
        await slipBet("tg_2");
        await slipBet("owner");
        const send = vi.fn((_chatId: number, _text: string) => Promise.resolve());

        const soon = await remindOpenBets({ repos, send, now: () => new Date(Date.now() + 3_600_000) });
        expect(soon).toBe(0);

        const later = new Date(Date.now() + 13 * 3_600_000);
        expect(await remindOpenBets({ repos, send, now: () => later })).toBe(2);
        expect(send.mock.calls).toEqual([
            [1, expect.stringMatching(/^🔔 You have 1 open bet from earlier/) as string],
            [2, expect.stringMatching(/^🔔 You have 2 open bets from earlier/) as string],
        ]);
    });

    it("leaves out match results on tracked fixtures, which settle themselves", async () => {
        const kickoff = new Date(Date.now() + 2 * 3_600_000);
        await repos.fixtures.upsert([{ id: "f1", league: "soccer_epl", homeTeam: "A", awayTeam: "B", kickoff }]);
        await repos.bets.place({
            playerId: "tg_2",
            fixtureId: "f1",
            eventName: "A – B",
            market: "h2h",
            selection: "home",
            stakeOre: 100_000,
            lockedOdds: 2,
            bookmaker: "nordicbet",
            selfReported: true,
        });
        const send = vi.fn((_chatId: number, _text: string) => Promise.resolve());
        expect(await remindOpenBets({ repos, send, now: () => new Date(Date.now() + 13 * 3_600_000) })).toBe(0);

        await slipBet("tg_2");
        expect(await remindOpenBets({ repos, send, now: () => new Date(Date.now() + 13 * 3_600_000) })).toBe(1);
        expect(send.mock.calls[0]?.[1]).toMatch(/^🔔 You have 1 open bet from earlier/);
    });
});
