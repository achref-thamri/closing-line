import { OUTCOMES, type Outcome } from "@closing-line/core";

/** Bookmakers in football-data.co.uk files that stand in for the soft books we poll (column prefix → name). */
export const SOFT_BOOKS = { B365: "bet365", BW: "bwin", WH: "williamhill", "1XB": "1xbet" } as const;

export type Prices = Record<Outcome, number>;

/** One match from a season file: Pinnacle's early and closing prices, the soft books' early prices, the score. */
export interface PastMatch {
    date: string;
    home: string;
    away: string;
    homeGoals: number;
    awayGoals: number;
    /** Pinnacle about a day or two before kickoff (Friday for weekend games), close to our morning poll. */
    sharpEarly: Prices;
    sharpClosing: Prices;
    soft: Partial<Record<keyof typeof SOFT_BOOKS, Prices>>;
}

const SUFFIX: Record<Outcome, string> = { home: "H", draw: "D", away: "A" };

/**
 * Parses a football-data.co.uk season CSV. Matches without a score or without Pinnacle's early and closing prices
 * are skipped (newer seasons have no Pinnacle columns at all).
 */
export function parseSeason(csv: string): PastMatch[] {
    const [headerLine, ...rows] = csv.replace(/^\uFEFF/, "").split(/\r?\n/);
    const header = (headerLine ?? "").split(",");
    const matches: PastMatch[] = [];
    for (const row of rows) {
        if (row.trim() === "") continue;
        const cells = row.split(",");
        const value = (name: string) => cells[header.indexOf(name)] ?? "";
        const prices = (prefix: string): Prices | undefined => {
            const odds = OUTCOMES.map((outcome) => Number(value(`${prefix}${SUFFIX[outcome]}`)));
            if (odds.some((price) => !(price > 1))) return undefined;
            const [home = 0, draw = 0, away = 0] = odds;
            return { home, draw, away };
        };
        const sharpEarly = prices("PS");
        const sharpClosing = prices("PSC");
        const homeGoals = Number.parseInt(value("FTHG"), 10);
        const awayGoals = Number.parseInt(value("FTAG"), 10);
        if (!sharpEarly || !sharpClosing || Number.isNaN(homeGoals) || Number.isNaN(awayGoals)) continue;
        const soft: PastMatch["soft"] = {};
        for (const prefix of Object.keys(SOFT_BOOKS) as (keyof typeof SOFT_BOOKS)[]) {
            const quoted = prices(prefix);
            if (quoted) soft[prefix] = quoted;
        }
        matches.push({
            date: value("Date"),
            home: value("HomeTeam"),
            away: value("AwayTeam"),
            homeGoals,
            awayGoals,
            sharpEarly,
            sharpClosing,
            soft,
        });
    }
    return matches;
}
