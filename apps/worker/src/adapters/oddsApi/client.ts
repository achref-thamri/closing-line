import type { Outcome } from "@closing-line/core";
import { z } from "zod";
import { HttpError } from "../../lib/errors.ts";
import { getJson, type Fetch } from "../../lib/http.ts";
import { retry, type RetryOptions } from "../../lib/retry.ts";
import {
    OutOfCreditsError,
    type CreditBalance,
    type EventInfo,
    type EventOdds,
    type OddsSource,
    type Priced,
    type Quote,
} from "../../ports/odds.ts";

const BASE_URL = "https://api.the-odds-api.com/v4";
/** Each call names at most ten bookmakers, which costs one credit per market. */
const MAX_BOOKMAKERS = 10;

const eventSchema = z.object({
    id: z.string().length(32),
    sport_key: z.string(),
    commence_time: z.iso.datetime(),
    home_team: z.string(),
    away_team: z.string(),
});

const oddsSchema = z.array(
    eventSchema.extend({
        bookmakers: z.array(
            z.object({
                key: z.string(),
                last_update: z.iso.datetime(),
                markets: z.array(
                    z.object({
                        key: z.string(),
                        last_update: z.iso.datetime().optional(),
                        outcomes: z.array(z.object({ name: z.string(), price: z.number().gt(1) })),
                    }),
                ),
            }),
        ),
    }),
);

export interface OddsApiOptions {
    apiKey: string;
    now?: () => Date;
    fetch?: Fetch;
    retry?: RetryOptions;
}

/**
 * The Odds API v4. The key travels in the query string, so URLs never reach logs or error messages.
 * Every response carries the credit balance in its headers, including the free calls.
 */
export class OddsApiClient implements OddsSource {
    private readonly options: OddsApiOptions;
    private readonly now: () => Date;

    constructor(options: OddsApiOptions) {
        this.options = options;
        this.now = options.now ?? (() => new Date());
    }

    async events(league: string): Promise<Priced<EventInfo[]>> {
        const { data, balance } = await this.get(`/sports/${league}/events`, z.array(eventSchema), "events", {});
        return { data: data.map(toEventInfo), balance };
    }

    async odds(league: string, bookmakers: readonly string[]): Promise<Priced<EventOdds[]>> {
        if (bookmakers.length === 0 || bookmakers.length > MAX_BOOKMAKERS) {
            throw new RangeError(`Name 1 to ${MAX_BOOKMAKERS} bookmakers per call, got ${bookmakers.length}`);
        }
        const { data, balance } = await this.get(`/sports/${league}/odds`, oddsSchema, "odds", {
            markets: "h2h",
            oddsFormat: "decimal",
            bookmakers: bookmakers.join(","),
        });
        return {
            data: data.map((event) => ({
                ...toEventInfo(event),
                quotes: event.bookmakers.flatMap((bookmaker) =>
                    bookmaker.markets
                        .filter((market) => market.key === "h2h")
                        .flatMap((market) =>
                            market.outcomes.flatMap((outcome): Quote[] => {
                                const selection = selectionOf(outcome.name, event);
                                if (!selection) return [];
                                return [
                                    {
                                        bookmaker: bookmaker.key,
                                        market: "h2h",
                                        selection,
                                        price: outcome.price,
                                        updatedAt: new Date(market.last_update ?? bookmaker.last_update),
                                    },
                                ];
                            }),
                        ),
                ),
            })),
            balance,
        };
    }

    async balance(): Promise<CreditBalance> {
        const { balance } = await this.get("/sports", z.array(z.unknown()), "sports", {});
        return balance;
    }

    private async get<S extends z.ZodType>(
        path: string,
        schema: S,
        label: string,
        params: Record<string, string>,
    ): Promise<Priced<z.output<S>>> {
        const url = new URL(BASE_URL + path);
        for (const [key, value] of Object.entries({ ...params, dateFormat: "iso", apiKey: this.options.apiKey })) {
            url.searchParams.set(key, value);
        }
        try {
            const { data, headers } = await retry(
                () =>
                    getJson({
                        url,
                        schema,
                        label: `Odds API ${label}`,
                        ...(this.options.fetch && { fetch: this.options.fetch }),
                    }),
                this.options.retry,
            );
            return { data, balance: balanceFrom(headers, this.now()) };
        } catch (error) {
            if (error instanceof HttpError && error.body.includes("OUT_OF_USAGE_CREDITS")) {
                throw new OutOfCreditsError("Odds API: the monthly credits are used up", { cause: error });
            }
            throw error;
        }
    }
}

function toEventInfo(event: z.output<typeof eventSchema>): EventInfo {
    return {
        id: event.id,
        league: event.sport_key,
        homeTeam: event.home_team,
        awayTeam: event.away_team,
        kickoff: new Date(event.commence_time),
    };
}

/** Outcomes are named after the teams, or "Draw". */
function selectionOf(name: string, event: { home_team: string; away_team: string }): Outcome | undefined {
    if (name === event.home_team) return "home";
    if (name === event.away_team) return "away";
    if (name === "Draw") return "draw";
    return undefined;
}

/** Missing headers read as zero, which stops paid calls: safer than guessing a balance. */
function balanceFrom(headers: Headers, takenAt: Date): CreditBalance {
    const read = (name: string) => {
        const value = Number(headers.get(name));
        return headers.has(name) && Number.isFinite(value) ? value : 0;
    };
    return {
        used: read("x-requests-used"),
        remaining: read("x-requests-remaining"),
        lastCost: read("x-requests-last"),
        takenAt,
    };
}
