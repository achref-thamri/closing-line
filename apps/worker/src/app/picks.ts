import type { Config } from "@closing-line/config";
import {
    bookName,
    fairProbabilities,
    findValueBets,
    isOutcome,
    minimumOdds,
    type PriceQuote,
} from "@closing-line/core";
import type { Fixture, Repositories } from "@closing-line/db";

const HOUR_MS = 3_600_000;
/** Pinnacle prices older than this no longer say what is fair. */
const MAX_SHARP_AGE_MS = 24 * HOUR_MS;

export interface PicksDeps {
    repos: Pick<Repositories, "fixtures" | "odds">;
    config: Pick<Config, "sharpBookmaker" | "exchangeCommission" | "scanner" | "timezone">;
    now: () => Date;
    /** Fetches fresh odds where the stored ones are old, within the credit guard; called before reading. */
    refresh?: () => Promise<void>;
}

interface Candidate {
    fixture: Fixture;
    team: string;
    bookmaker: string;
    price: number;
    edge: number;
    fairOdds: number;
    /** The lowest price still worth backing at the scanner's edge threshold. */
    minOdds: number;
    seenAt: Date;
}

/**
 * The best prices above Pinnacle's fair price for matches in the next `hours`, from the stored odds (refreshed
 * first when old). Value at the scanner's threshold is marked ✅, smaller edges 🟡.
 */
export async function bestPicks(deps: PicksDeps, options: { hours?: number; limit?: number } = {}): Promise<string> {
    const { config } = deps;
    await deps.refresh?.();
    const now = deps.now();
    const hours = options.hours ?? 7 * 24;
    const fixtures = await deps.repos.fixtures.between(now, new Date(now.getTime() + hours * HOUR_MS), "scheduled");
    const picks: Candidate[] = [];
    for (const fixture of fixtures) {
        const snapshots = (await deps.repos.odds.latest(fixture.id)).filter((snapshot) => snapshot.market === "h2h");
        const quotes: PriceQuote[] = snapshots.flatMap((snapshot) =>
            isOutcome(snapshot.selection)
                ? [
                      {
                          bookmaker: snapshot.bookmaker,
                          selection: snapshot.selection,
                          price: snapshot.price,
                          updatedAt: snapshot.bookmakerUpdatedAt,
                      },
                  ]
                : [],
        );
        const fair = fairProbabilities(quotes, config.sharpBookmaker, now, MAX_SHARP_AGE_MS);
        if (!fair) continue;
        const seenAt = new Date(Math.max(...snapshots.map((snapshot) => snapshot.takenAt.getTime())));
        const values = findValueBets(quotes, fair, {
            sharpBookmaker: config.sharpBookmaker,
            commission: config.exchangeCommission,
            minEdge: 0.000_1,
        });
        for (const value of values) {
            const team =
                value.selection === "home" ? fixture.homeTeam : value.selection === "away" ? fixture.awayTeam : "Draw";
            picks.push({
                fixture,
                team,
                bookmaker: value.bookmaker,
                price: value.offeredOdds,
                edge: value.edge,
                fairOdds: value.fairOdds,
                minOdds: minimumOdds(value.fairOdds, config.scanner.minEdge, config.scanner.minKellyFraction),
                seenAt,
            });
        }
    }
    picks.sort((a, b) => b.edge - a.edge);

    const time = (date: Date, weekday: boolean) =>
        date.toLocaleString("en-GB", {
            timeZone: config.timezone,
            hour: "2-digit",
            minute: "2-digit",
            ...(weekday ? { weekday: "short" } : {}),
        });
    if (picks.length === 0) {
        return "🎯 No prices above the fair price for the coming week right now. Value is rare; try again after the next price check (match-day mornings and before kickoffs).";
    }
    const lines = picks.slice(0, options.limit ?? 8).map((pick) => {
        const tipworthy = pick.price >= pick.minOdds && pick.fairOdds < config.scanner.maxFairOdds;
        const mark = tipworthy ? "✅" : "🟡";
        return (
            `${mark} ${pick.team} @ ${pick.price.toFixed(2)} at ${bookName(pick.bookmaker)} (+${(pick.edge * 100).toFixed(1)}%)\n` +
            `   ${pick.fixture.homeTeam} v ${pick.fixture.awayTeam}, ${time(pick.fixture.kickoff, true)} · seen ${time(pick.seenAt, false)} · worth it at ${pick.minOdds.toFixed(2)}+`
        );
    });
    return [
        "🎯 Best prices for the coming week:",
        "",
        ...lines,
        "",
        `✅ at or above "worth it at", like the tips. 🟡 below it, or an outsider (fair odds ${config.scanner.maxFairOdds}+): weaker, often noise. Odds move, so check the price before you bet.`,
    ].join("\n");
}
