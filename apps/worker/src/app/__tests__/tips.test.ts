import { describe, expect, it, vi } from "vitest";
import { silentLogger } from "../../lib/logger.ts";
import { bookName, createTipSender, formatTip, tipRecipients, type Tip } from "../tips.ts";

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

    it("shows only the person's books, and nothing when none of them pays enough", () => {
        const text = formatTip(tip, TZ, ["nordicbet", "marathonbet"]);
        expect(text).toMatch(/^🔎 Value bet: Watford @ 3.25 at NordicBet\n/);
        expect(text).toContain("Also: Marathonbet 3.20 (+3.2%)");
        expect(text).not.toContain("Unibet");
        expect(formatTip(tip, TZ, ["casumo"])).toBeUndefined();
    });

    it("keeps unknown bookmaker keys as they are", () => {
        expect(bookName("some_new_book")).toBe("some_new_book");
    });
});

describe("createTipSender", () => {
    it("sends each person the tip at their books, skipping the muted and those who cannot place it", async () => {
        const send = vi.fn((_chatId: number, _text: string) => Promise.resolve());
        const sendTip = createTipSender({
            timeZone: TZ,
            logger: silentLogger,
            send,
            recipients: () =>
                Promise.resolve([
                    { chatId: 1, bookmakers: null, muted: false },
                    { chatId: 2, bookmakers: ["nordicbet"], muted: false },
                    { chatId: 3, bookmakers: ["casumo"], muted: false },
                    { chatId: 4, bookmakers: null, muted: true },
                ]),
        });
        await sendTip(tip);
        expect(send.mock.calls.map(([chatId, text]) => [chatId, text.split("\n")[0]])).toEqual([
            [1, "🔎 Value bet: Watford @ 3.40 at Unibet"],
            [2, "🔎 Value bet: Watford @ 3.25 at NordicBet"],
        ]);
    });
});

describe("tipRecipients", () => {
    const human = { kind: "human" as const, bookmakers: null, tipsMuted: false };

    it("adds the owner until they have their own settings, and skips players without a chat", () => {
        const players = [
            { ...human, telegramChatId: "200", bookmakers: ["nordicbet"] },
            { ...human, kind: "scanner" as const, telegramChatId: null },
            { ...human, telegramChatId: null },
        ];
        expect(tipRecipients(players, 100)).toEqual([
            { chatId: 100, bookmakers: null, muted: false },
            { chatId: 200, bookmakers: ["nordicbet"], muted: false },
        ]);
        expect(tipRecipients([...players, { ...human, telegramChatId: "100", tipsMuted: true }], 100)).toEqual([
            { chatId: 200, bookmakers: ["nordicbet"], muted: false },
            { chatId: 100, bookmakers: null, muted: true },
        ]);
    });
});
