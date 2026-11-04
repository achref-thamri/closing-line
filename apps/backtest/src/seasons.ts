import { OUTCOMES, type Outcome } from "@closing-line/core";

/** Bookmakers in football-data.co.uk files that stand in for the soft books we poll (column prefix → name). */
export const SOFT_BOOKS = { B365: "bet365", BW: "bwin", WH: "williamhill", "1XB": "1xbet" } as const;

export type Prices = Record<Outcome, number>;

/** A finished match from a season file, with its division code (E0, SP2, …). */
export interface SeasonResult {
    league: string;
    home: string;
    away: string;
    homeGoals: number;
    awayGoals: number;
    playedAt: Date;
}

/** One match from a season file: Pinnacle's early and closing prices, the soft books' early prices, the score. */
export interface PastMatch extends SeasonResult {
    /** Pinnacle about a day or two before kickoff (Friday for weekend games), close to our morning poll. */
    sharpEarly: Prices;
    sharpClosing: Prices;
    soft: Partial<Record<keyof typeof SOFT_BOOKS, Prices>>;
}

const SUFFIX: Record<Outcome, string> = { home: "H", draw: "D", away: "A" };
// The files start with a UTF-8 byte order mark, which reads as these three characters when decoded as latin1.
const BYTE_ORDER_MARK = /^(\uFEFF|\u00EF\u00BB\u00BF)/;

/**
 * Parses a football-data.co.uk season CSV. Matches without a score or without Pinnacle's early and closing prices
 * are skipped (newer seasons have no Pinnacle columns at all).
 */
export function parseSeason(csv: string): PastMatch[] {
    const matches: PastMatch[] = [];
    for (const value of rowsOf(csv)) {
        const prices = (prefix: string): Prices | undefined => {
            const odds = OUTCOMES.map((outcome) => Number(value(`${prefix}${SUFFIX[outcome]}`)));
            if (odds.some((price) => !(price > 1))) return undefined;
            const [home = 0, draw = 0, away = 0] = odds;
            return { home, draw, away };
        };
        const result = resultOf(value);
        const sharpEarly = prices("PS");
        const sharpClosing = prices("PSC");
        if (!result || !sharpEarly || !sharpClosing) continue;
        const soft: PastMatch["soft"] = {};
        for (const prefix of Object.keys(SOFT_BOOKS) as (keyof typeof SOFT_BOOKS)[]) {
            const quoted = prices(prefix);
            if (quoted) soft[prefix] = quoted;
        }
        matches.push({ ...result, sharpEarly, sharpClosing, soft });
    }
    return matches;
}

type Cell = (column: string) => string;

function rowsOf(csv: string): Cell[] {
    const [headerLine, ...rows] = csv.replace(BYTE_ORDER_MARK, "").split(/\r?\n/);
    const header = (headerLine ?? "").split(",");
    return rows
        .filter((row) => row.trim() !== "")
        .map((row) => {
            const cells = row.split(",");
            return (column: string) => cells[header.indexOf(column)] ?? "";
        });
}

function resultOf(value: Cell): SeasonResult | undefined {
    const homeGoals = Number.parseInt(value("FTHG"), 10);
    const awayGoals = Number.parseInt(value("FTAG"), 10);
    const playedAt = dateOf(value("Date"));
    if (Number.isNaN(homeGoals) || Number.isNaN(awayGoals) || !playedAt) return undefined;
    return { league: value("Div"), home: value("HomeTeam"), away: value("AwayTeam"), homeGoals, awayGoals, playedAt };
}

/** Dates are dd/mm/yyyy, or dd/mm/yy in some older files. */
function dateOf(text: string): Date | undefined {
    const [day, month, year] = text.split("/").map(Number);
    if (!day || !month || year === undefined || Number.isNaN(year)) return undefined;
    return new Date(Date.UTC(year < 100 ? 2000 + year : year, month - 1, day));
}
