import { describe, expect, it, vi } from "vitest";
import { silentLogger } from "../../lib/logger.ts";
import type { Reply } from "../chat.ts";
import {
    createPriceGoneSender,
    createTipSender,
    formatPriceGone,
    formatTip,
    tipKeyboard,
    tipRecipients,
    type PriceGone,
    type Tip,
} from "../tips.ts";

const tip: Tip = {
    fixtureId: "f".repeat(32),
    selection: "away",
    homeTeam: "Hull City",
    awayTeam: "Watford",
    kickoff: new Date("2026-11-07T15:00:00Z"),
    pick: "Watford",
    fairOdds: 3.1,
    minOdds: 3.17,
    offers: [
        { bookmaker: "unibet_se", offeredOdds: 3.4, netOdds: 3.4, edge: 0.0968 },
        { bookmaker: "nordicbet", offeredOdds: 3.25, netOdds: 3.25, edge: 0.0484 },
        { bookmaker: "marathonbet", offeredOdds: 3.2, netOdds: 3.2, edge: 0.0323 },
    ],
    paperStakeKr: 120,
    seenAt: new Date("2026-11-04T08:02:00Z"),
};
const TZ = "Europe/Copenhagen";

describe("formatTip", () => {
    it("shows the best book first and the others after", () => {
        expect(formatTip(tip, TZ)).toBe(
            [
                "🔎 Value bet: Watford @ 3.40 at Unibet",
                "Hull City v Watford, Sat 16:00",
                "Also: NordicBet 3.25 (+4.8%), Marathonbet 3.20 (+3.2%)",
                "Fair 3.10, edge 9.7%, paper stake 120 kr",
                "💡 Pinnacle, the sharpest bookmaker, prices this at 3.10 once its margin is removed. 3.40 pays 9.7% more than the bet is worth, so it wins money over many bets like it, not every time.",
                "Price seen 09:02. Worth it at 3.17 or better, so check your bookmaker's price first.",
            ].join("\n"),
        );
    });

    it("sends nothing without an offer", () => {
        expect(formatTip({ ...tip, offers: [] }, TZ)).toBeUndefined();
    });
});

describe("tipKeyboard", () => {
    it("offers one I-bet-this button per book, best first, with what the bet flow needs", () => {
        expect(tipKeyboard(tip)).toEqual([
            [{ text: "✅ I bet this at Unibet 3.40", data: `tb:${"f".repeat(32)}:away:unibet_se:3.40` }],
            [{ text: "✅ I bet this at NordicBet 3.25", data: `tb:${"f".repeat(32)}:away:nordicbet:3.25` }],
            [{ text: "✅ I bet this at Marathonbet 3.20", data: `tb:${"f".repeat(32)}:away:marathonbet:3.20` }],
        ]);
    });

    it("leaves out a button whose data would pass Telegram's 64 bytes", () => {
        const offer = { bookmaker: "a_bookmaker_with_a_long_key", offeredOdds: 3.4, netOdds: 3.4, edge: 0.0968 };
        const long = { ...tip, offers: [offer] };
        expect(tipKeyboard(long)).toEqual([]);
    });
});

describe("createTipSender", () => {
    it("sends everyone the same tip, except people who paused tips", async () => {
        const send = vi.fn((_chatId: number, _reply: Reply) => Promise.resolve());
        const sendTip = createTipSender({
            timeZone: TZ,
            logger: silentLogger,
            send,
            recipients: () =>
                Promise.resolve([
                    { chatId: 1, muted: false },
                    { chatId: 2, muted: false },
                    { chatId: 4, muted: true },
                ]),
        });
        await sendTip(tip);
        await sendTip({ ...tip, offers: [] });
        expect(send.mock.calls.map(([chatId]) => chatId)).toEqual([1, 2]);
        expect(send.mock.calls[0]?.[1]).toBe(send.mock.calls[1]?.[1]);
        expect(send.mock.calls[0]?.[1].keyboard).toHaveLength(3);
    });

    it("still sends to the others when one message fails", async () => {
        const send = vi.fn((chatId: number) =>
            chatId === 1 ? Promise.reject(new Error("blocked")) : Promise.resolve(),
        );
        const warn = vi.fn();
        const sendTip = createTipSender({
            timeZone: TZ,
            logger: { ...silentLogger, warn },
            send,
            recipients: () =>
                Promise.resolve([
                    { chatId: 1, muted: false },
                    { chatId: 2, muted: false },
                ]),
        });
        await sendTip(tip);
        expect(send).toHaveBeenCalledTimes(2);
        expect(warn).toHaveBeenCalledWith({ chatId: 1, error: "blocked" }, "value tip not delivered");
    });
});

describe("price gone", () => {
    const gone: PriceGone = {
        homeTeam: "Hull City",
        awayTeam: "Watford",
        kickoff: new Date("2026-11-07T15:00:00Z"),
        pick: "Watford",
        tippedOdds: 3.4,
        tippedAt: new Date("2026-11-07T08:02:00Z"),
        fairOdds: 3.15,
    };

    it("says what the best price is now, or that nobody lists it", () => {
        expect(formatPriceGone({ ...gone, best: { bookmaker: "nordicbet", offeredOdds: 3.05 } }, TZ)).toBe(
            [
                "⌛ Price gone: Watford, tipped at 3.40 on Sat 09:02",
                "Hull City v Watford, Sat 16:00",
                "Best now 3.05 at NordicBet, below the fair 3.15. If you haven't bet it, skip it. If you have, you got the better price.",
            ].join("\n"),
        );
        expect(formatPriceGone(gone, TZ)).toContain("No bookmaker lists it now; fair is 3.15.");
    });

    it("goes to everyone who gets tips", async () => {
        const send = vi.fn((_chatId: number, _reply: Reply) => Promise.resolve());
        const sendGone = createPriceGoneSender({
            timeZone: TZ,
            logger: silentLogger,
            send,
            recipients: () =>
                Promise.resolve([
                    { chatId: 1, muted: false },
                    { chatId: 4, muted: true },
                ]),
        });
        await sendGone(gone);
        expect(send.mock.calls.map(([chatId]) => chatId)).toEqual([1]);
        expect(send.mock.calls[0]?.[1].keyboard).toBeUndefined();
    });
});

describe("tipRecipients", () => {
    const bettor = { kind: "bettor" as const, tipsMuted: false };

    it("always includes the owner once, and skips players without a chat", () => {
        const players = [
            { ...bettor, telegramChatId: "200" },
            { ...bettor, kind: "scanner" as const, telegramChatId: null },
            { ...bettor, telegramChatId: null },
        ];
        expect(tipRecipients(players, 100)).toEqual([
            { chatId: 100, muted: false },
            { chatId: 200, muted: false },
        ]);
        expect(tipRecipients([...players, { ...bettor, telegramChatId: "100", tipsMuted: true }], 100)).toEqual([
            { chatId: 200, muted: false },
            { chatId: 100, muted: true },
        ]);
    });
});
