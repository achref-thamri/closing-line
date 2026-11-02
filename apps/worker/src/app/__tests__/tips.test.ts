import { describe, expect, it, vi } from "vitest";
import { silentLogger } from "../../lib/logger.ts";
import { createTipSender, formatTip, tipRecipients, type Tip } from "../tips.ts";

const tip: Tip = {
    homeTeam: "Hull City",
    awayTeam: "Watford",
    kickoff: new Date("2026-11-07T15:00:00Z"),
    pick: "Watford",
    fairOdds: 3.1,
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
                "Price seen 09:02; check it is still there before you bet.",
            ].join("\n"),
        );
    });

    it("sends nothing without an offer", () => {
        expect(formatTip({ ...tip, offers: [] }, TZ)).toBeUndefined();
    });
});

describe("createTipSender", () => {
    it("sends everyone the same tip, except people who paused tips", async () => {
        const send = vi.fn((_chatId: number, _text: string) => Promise.resolve());
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
