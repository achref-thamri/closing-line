import { bookName, pickText } from "@closing-line/core";

/** What a bet card shows; a stored bet has it, and a bet being logged is turned into one. */
export interface BetCard {
    bookmaker: string;
    eventName: string | null;
    market: string;
    selection: string;
    playerName: string | null;
    line: number | null;
    lockedOdds: number;
    stakeOre: number;
}

/** The card text for a bet: bookmaker and match, the pick, then odds and stake. */
export function describeBet(bet: BetCard): string {
    return [
        `🧾 ${bookName(bet.bookmaker)} · ${bet.eventName ?? ""}`.trim(),
        pickText(bet),
        `Odds ${bet.lockedOdds.toFixed(2)} · Stake ${kroner(bet.stakeOre)}`,
    ].join("\n");
}

export function kroner(ore: number): string {
    return `${(ore / 100).toLocaleString("en-GB", { maximumFractionDigits: 2 })} kr`;
}

/** "+897.17 kr" or "−1,500 kr". */
export function signedKroner(ore: number): string {
    return `${ore >= 0 ? "+" : "−"}${kroner(Math.abs(ore))}`;
}

/** "3.70" or "3,70" as a number; undefined otherwise. */
export function parseDecimal(text: string): number | undefined {
    if (!/^\d+(?:[.,]\d+)?$/.test(text.trim())) return undefined;
    return Number(text.trim().replace(",", "."));
}

/** Reads "2557", "2557 kr", "2.557,17" (Danish) or "2,557.17" as kroner; undefined when it is not one amount. */
export function parseKroner(text: string): number | undefined {
    const cleaned = text.replace(/kr\.?|dkk/gi, "").replace(/\s/g, "");
    if (!/^\d[\d.,]*$/.test(cleaned)) return undefined;
    const lastSeparator = Math.max(cleaned.lastIndexOf(","), cleaned.lastIndexOf("."));
    const decimals = lastSeparator >= 0 && cleaned.length - lastSeparator - 1 <= 2 ? lastSeparator : -1;
    const whole = (decimals >= 0 ? cleaned.slice(0, decimals) : cleaned).replace(/[.,]/g, "");
    const fraction = decimals >= 0 ? cleaned.slice(decimals + 1) : "";
    const value = Number(`${whole}.${fraction || "0"}`);
    return Number.isFinite(value) && value > 0 ? value : undefined;
}
