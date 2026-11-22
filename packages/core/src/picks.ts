import type { Outcome } from "./settlement.ts";

/** Display names for bookmaker keys: The Odds API's (tips) and the Danish sites bettors pick in Telegram. */
const BOOK_NAMES: ReadonlyMap<string, string> = new Map([
    ["pinnacle", "Pinnacle"],
    ["nordicbet", "NordicBet"],
    ["marathonbet", "Marathonbet"],
    ["betsson", "Betsson"],
    ["unibet_se", "Unibet"],
    ["unibet", "Unibet"],
    ["leovegas_se", "LeoVegas"],
    ["leovegas", "LeoVegas"],
    ["sport888", "888sport"],
    ["casumo", "Casumo"],
    ["coolbet", "Coolbet"],
    ["betfair_ex_eu", "Betfair Exchange"],
    ["matchbook", "Matchbook"],
    ["williamhill", "William Hill"],
    ["bet25", "Bet25"],
    ["danske_spil", "Danske Spil"],
    ["comeon", "ComeOn"],
    ["betano", "Betano"],
    ["campobet", "Campobet"],
    ["merkurbets", "MerkurBets"],
    ["bet365", "bet365"],
]);

/** A bookmaker's display name; unknown keys are title-cased ("expekt" → "Expekt"). */
export function bookName(book: string): string {
    return (
        BOOK_NAMES.get(book) ??
        book
            .split("_")
            .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
            .join(" ")
    );
}

/**
 * The two sides of "Bayern – Arsenal", "Bayern v Arsenal" or "Bayern-Arsenal"; empty when it does not split. A
 * separator with spaces around it wins, so "Paris Saint-Germain – Lille" keeps the hyphen in the team name.
 */
export function teamsOf(eventName: string): [string, string] | [] {
    // One space at a time keeps the split linear; runs of whitespace would make these patterns quadratic.
    const name = eventName.replace(/\s+/g, " ");
    const spaced = / (?:v|vs|–|-) /i;
    const parts = name.split(spaced.test(name) ? spaced : / ?[–-] ?/).map((part) => part.trim());
    const [home, away] = parts;
    return parts.length === 2 && home && away ? [home, away] : [];
}

/** The team a match-result selection backs, or "Draw". */
export function sideName(match: { homeTeam: string; awayTeam: string }, selection: Outcome): string {
    if (selection === "home") return match.homeTeam;
    if (selection === "away") return match.awayTeam;
    return "Draw";
}

const MARKET_LABELS: ReadonlyMap<string, string> = new Map([
    ["player_shots_on_target", "shots on target"],
    ["player_shots", "shots"],
    ["player_fouls", "fouls"],
    ["player_cards", "cards"],
    ["player_goal", "to score"],
    ["corners", "corners"],
    ["cards", "cards"],
    ["match_winner", "to win"],
]);

/**
 * What a bet backed, in words: "Davies shots on target over 0.5", "Bayern to win", "Draw". Match results are
 * stored as home/draw/away and named from the event ("Bayern – Arsenal") or the fixture's teams when given.
 */
export function pickText(bet: {
    market: string;
    selection: string;
    playerName: string | null;
    line: number | null;
    eventName?: string | null;
    teams?: readonly [string, string];
}): string {
    if (bet.selection === "over" || bet.selection === "under") {
        const market = MARKET_LABELS.get(bet.market) ?? bet.market;
        return `${bet.playerName ?? ""} ${market} ${bet.selection}${bet.line === null ? "" : ` ${bet.line}`}`.trim();
    }
    if (bet.market === "match_result" || bet.market === "h2h") {
        const [home, away] = bet.teams ?? teamsOf(bet.eventName ?? "");
        if (bet.selection === "draw") return "Draw";
        if (bet.selection === "home" && home) return `${home} to win`;
        if (bet.selection === "away" && away) return `${away} to win`;
        return bet.selection;
    }
    const market = MARKET_LABELS.get(bet.market);
    return market ? `${bet.selection} ${market}` : bet.selection;
}
