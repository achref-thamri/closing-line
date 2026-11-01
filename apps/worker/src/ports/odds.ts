import type { Outcome } from "@betting/core";

export interface EventInfo {
    /** The Odds API event id, also the fixture id. */
    id: string;
    /** The Odds API sport key, e.g. `soccer_epl`. */
    league: string;
    homeTeam: string;
    awayTeam: string;
    kickoff: Date;
}

export interface Quote {
    bookmaker: string;
    market: "h2h";
    selection: Outcome;
    price: number;
    /** When the bookmaker last changed the price. */
    updatedAt: Date;
}

export interface EventOdds extends EventInfo {
    quotes: Quote[];
}

/** Credit balance reported with every response. */
export interface CreditBalance {
    used: number;
    remaining: number;
    /** Cost of the call that reported this balance. */
    lastCost: number;
    takenAt: Date;
}

export interface Priced<T> {
    data: T;
    balance: CreditBalance;
}

/** Fixtures and bookmaker prices. Only `odds` costs credits; the other calls are free. */
export interface OddsSource {
    events(league: string): Promise<Priced<EventInfo[]>>;
    odds(league: string, bookmakers: readonly string[]): Promise<Priced<EventOdds[]>>;
    balance(): Promise<CreditBalance>;
}

/** The monthly quota is used up; calls fail until it resets. */
export class OutOfCreditsError extends Error {
    override name = "OutOfCreditsError";
}
