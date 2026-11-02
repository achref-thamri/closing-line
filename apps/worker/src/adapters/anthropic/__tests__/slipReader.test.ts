import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it, vi } from "vitest";
import { PermanentError } from "../../../lib/errors.ts";
import { ClaudeSlipReader, toDraft } from "../slipReader.ts";

// Made-up slips in the shape of real ones: a settled player prop, an open esports bet, a cash-out.
const propBet = {
    bookmaker: "NordicBet",
    sport: "football",
    competition: "Premier League",
    eventName: "Brentford – Fulham",
    market: "player_shots_on_target",
    marketText: "Antal afslutninger på mål",
    playerName: "Test Spiller",
    selection: "over",
    line: 0.5,
    odds: 3.6,
    stakeKroner: 1250,
    couponId: "1234567890",
    placedAtLocal: "2026-10-25T15:12",
    status: "won",
    payoutKroner: 4500,
} as const;

const esportsBet = {
    ...propBet,
    bookmaker: "Danske Spil",
    sport: "counter_strike",
    competition: null,
    eventName: "Team A – Team B",
    market: "match_winner",
    marketText: "Vinder",
    playerName: " ",
    selection: "Team B",
    line: null,
    odds: 2.75,
    stakeKroner: 812.5,
    couponId: "",
    placedAtLocal: "yesterday 20:20",
    status: "open",
    payoutKroner: null,
} as const;

function fakeClient(response: object) {
    const parse = vi.fn().mockResolvedValue(response);
    return { client: { beta: { messages: { parse } } } as unknown as Anthropic, parse };
}

const image = { data: Buffer.from("png bytes"), mediaType: "image/png" } as const;

describe("ClaudeSlipReader", () => {
    it("sends the screenshot and returns one draft per bet", async () => {
        const { client, parse } = fakeClient({
            stop_reason: "end_turn",
            parsed_output: { bets: [propBet, esportsBet] },
        });
        const drafts = await new ClaudeSlipReader({ client }).read(image);

        expect(drafts).toEqual([
            {
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
                couponId: "1234567890",
                placedAtLocal: "2026-10-25T15:12",
                status: "won",
                payoutOre: 450_000,
            },
            expect.objectContaining({
                bookmaker: "danske_spil",
                sport: "counter_strike",
                playerName: null,
                couponId: null,
                placedAtLocal: null,
                stakeOre: 81_250,
                payoutOre: null,
            }),
        ]);

        const params = parse.mock.calls[0]?.[0] as { model: string; messages: { content: unknown[] }[] };
        expect(params.model).toBe("claude-opus-5-5");
        expect(params.messages[0]?.content[0]).toEqual({
            type: "image",
            source: { type: "base64", media_type: "image/png", data: image.data.toString("base64") },
        });
    });

    it("fails permanently when Claude declines or nothing parses", async () => {
        const refused = fakeClient({ stop_reason: "refusal", parsed_output: null });
        await expect(new ClaudeSlipReader(refused).read(image)).rejects.toThrow(PermanentError);
        const empty = fakeClient({ stop_reason: "max_tokens", parsed_output: null });
        await expect(new ClaudeSlipReader(empty).read(image)).rejects.toThrow(/max_tokens/);
    });
});

describe("toDraft", () => {
    it("drops bets that cannot be real", () => {
        expect(toDraft({ ...propBet, odds: 1 })).toEqual([]);
        expect(toDraft({ ...propBet, stakeKroner: 0 })).toEqual([]);
    });

    it("keeps a cash-out with the amount it paid", () => {
        const [draft] = toDraft({ ...propBet, status: "cashed_out", payoutKroner: 2_010.55 });
        expect(draft).toMatchObject({ status: "cashed_out", payoutOre: 201_055 });
    });

    it("falls back to unknown when no bookmaker is visible", () => {
        expect(toDraft({ ...propBet, bookmaker: "  " })[0]?.bookmaker).toBe("unknown");
    });
});
