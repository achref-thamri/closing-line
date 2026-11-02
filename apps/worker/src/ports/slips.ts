/** Markets the friend bets most; anything else is `other` with the slip's own wording in `marketText`. */
export const SLIP_MARKETS = [
    "player_shots_on_target",
    "player_shots",
    "player_fouls",
    "player_cards",
    "player_goal",
    "corners",
    "cards",
    "match_result",
    "match_winner",
    "other",
] as const;
export type SlipMarket = (typeof SLIP_MARKETS)[number];

/** One bet as read from a bookmaker's bet slip, before the human confirms it. */
export interface SlipDraft {
    /** Bookmaker id in lower case, e.g. `nordicbet`, `bet25`, `danske_spil`; `unknown` when no brand is visible. */
    bookmaker: string;
    sport: "football" | "counter_strike" | "other";
    competition: string | null;
    /** The match as the slip names it, e.g. "Bayern München – Arsenal". */
    eventName: string;
    market: SlipMarket;
    /** The market as printed on the slip, e.g. "Antal afslutninger på mål". */
    marketText: string;
    playerName: string | null;
    /** `over`/`under` for lines, otherwise the team, player or outcome backed. */
    selection: string;
    /** The line for over/under markets; "2+" on a slip is over 1.5. */
    line: number | null;
    odds: number;
    stakeOre: number;
    couponId: string | null;
    /** Placement time as printed (Copenhagen local time), `YYYY-MM-DDTHH:mm`. */
    placedAtLocal: string | null;
    status: "open" | "won" | "lost" | "void" | "cashed_out";
    /** What the bet paid or would pay: the payout when won, the cash-out amount when cashed out. */
    payoutOre: number | null;
}

export interface SlipImage {
    data: Buffer;
    mediaType: "image/jpeg" | "image/png" | "image/webp";
}

/** Reads bets from a screenshot of a bet slip, or from a bet typed as text. */
export interface SlipReader {
    read(image: SlipImage): Promise<SlipDraft[]>;
    readText(text: string): Promise<SlipDraft[]>;
}
