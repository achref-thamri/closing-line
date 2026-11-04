import { closingLineValue, devigPower, findValueBets, OUTCOMES, outcomeOf, type Outcome } from "@closing-line/core";
import { fitGoalModel, matchProbabilities, type GoalModel, type ModelOptions } from "./goalModel.ts";
import type { PastMatch, Prices, SeasonResult } from "./seasons.ts";
import { quotesOf } from "./simulate.ts";

export interface ModelCheckOptions extends ModelOptions {
    /** Shares of the model in the fair price; the rest is Pinnacle's early price. 0 is the scanner as it runs. */
    blendWeights: readonly number[];
    minEdge: number;
}

/** Average log loss (lower is better) of three forecasts of the same matches. */
export interface LogLoss {
    matches: number;
    model: number;
    sharpEarly: number;
    sharpClosing: number;
}

export interface BlendResult {
    weight: number;
    /** Log loss of the blended fair price. */
    logLoss: number;
    bets: number;
    averageClv: number | undefined;
    beatClosing: number | undefined;
    /** Profit per bet at one unit staked on each. */
    flatRoi: number | undefined;
}

export interface ModelCheckResult {
    logLoss: LogLoss;
    /** First divisions (E0, SP1, …) and the divisions below them (E1, SP2, …) apart. */
    byTier: Record<"top" | "second", LogLoss>;
    blends: BlendResult[];
}

const DAY_MS = 86_400_000;
// 1 January 1970 was a Thursday, so Mondays fall on days 4, 11, 18, …
const FIRST_MONDAY = 4;
// Matches older than this many half-lives weigh under 1/8 and only slow the fit down.
const HISTORY_HALF_LIVES = 3;

/**
 * Walks forward through past matches the way a live model would run: each Monday the goal model is refitted on the
 * results played before it in the same country (both divisions, so promoted teams have history), then rates that
 * week's matches. Its forecasts are compared with Pinnacle's early and closing prices, and blends of model and
 * Pinnacle are run through the scanner against the soft books, with CLV measured on Pinnacle's close.
 */
export function checkModel(
    results: readonly SeasonResult[],
    matches: readonly PastMatch[],
    options: ModelCheckOptions,
): ModelCheckResult {
    const total = emptyLogLoss();
    const byTier = { top: emptyLogLoss(), second: emptyLogLoss() };
    const blends = options.blendWeights.map((weight) => ({ weight, logLoss: 0, bets: [] as Bet[] }));
    const resultsByCountry = Map.groupBy(results, (result) => countryOf(result.league));
    const models = new Map<string, GoalModel>();

    for (const match of matches.toSorted((a, b) => a.playedAt.getTime() - b.playedAt.getTime())) {
        const monday = mondayOf(match.playedAt);
        const country = countryOf(match.league);
        const key = `${country} ${monday.toISOString()}`;
        let model = models.get(key);
        if (!model) {
            const history = (resultsByCountry.get(country) ?? []).filter(
                (result) =>
                    result.playedAt < monday &&
                    monday.getTime() - result.playedAt.getTime() < HISTORY_HALF_LIVES * options.halfLifeDays * DAY_MS,
            );
            if (history.length === 0) continue;
            model = fitGoalModel(history, monday, options);
            models.set(key, model);
        }
        const forecast = matchProbabilities(model, match.home, match.away);
        if (!forecast) continue;

        const outcome = outcomeOf(match.homeGoals, match.awayGoals);
        const early = fairOf(match.sharpEarly);
        const closing = fairOf(match.sharpClosing);
        for (const tally of [total, byTier[tierOf(match.league)]]) {
            tally.matches++;
            tally.model -= Math.log(forecast[outcome]);
            tally.sharpEarly -= Math.log(early[outcome]);
            tally.sharpClosing -= Math.log(closing[outcome]);
        }
        for (const blend of blends) {
            const fair = mix(forecast, early, blend.weight);
            blend.logLoss -= Math.log(fair[outcome]);
            const values = findValueBets(quotesOf(match), fair, {
                sharpBookmaker: "pinnacle",
                commission: {},
                minEdge: options.minEdge,
            });
            for (const value of values) {
                blend.bets.push({
                    clv: closingLineValue(value.netOdds, 1 / closing[value.selection]),
                    profit: value.selection === outcome ? value.netOdds - 1 : -1,
                });
            }
        }
    }

    return {
        logLoss: averaged(total),
        byTier: { top: averaged(byTier.top), second: averaged(byTier.second) },
        blends: blends.map(({ weight, logLoss, bets }) => ({
            weight,
            logLoss: logLoss / Math.max(total.matches, 1),
            bets: bets.length,
            averageClv: meanOf(bets.map((bet) => bet.clv)),
            beatClosing: meanOf(bets.map((bet) => (bet.clv > 0 ? 1 : 0))),
            flatRoi: meanOf(bets.map((bet) => bet.profit)),
        })),
    };
}

interface Bet {
    clv: number;
    profit: number;
}

/** E0 → E, SP2 → SP: the divisions of one country share a model. */
function countryOf(league: string): string {
    return league.replace(/\d+$/, "");
}

// England (E0, E1, …) and Scotland (SC0, …) number their divisions from 0, the other countries from 1.
const NUMBERED_FROM_ZERO = new Set(["E", "SC"]);

function tierOf(league: string): "top" | "second" {
    const first = NUMBERED_FROM_ZERO.has(countryOf(league)) ? "0" : "1";
    return league.endsWith(first) ? "top" : "second";
}

function mondayOf(date: Date): Date {
    const day = Math.floor(date.getTime() / DAY_MS);
    return new Date((day - ((((day - FIRST_MONDAY) % 7) + 7) % 7)) * DAY_MS);
}

function fairOf(prices: Prices): Prices {
    const [home = 0, draw = 0, away = 0] = devigPower(OUTCOMES.map((outcome) => prices[outcome]));
    return { home, draw, away };
}

function mix(model: Record<Outcome, number>, sharp: Prices, weight: number): Prices {
    const [home = 0, draw = 0, away = 0] = OUTCOMES.map(
        (outcome) => weight * model[outcome] + (1 - weight) * sharp[outcome],
    );
    return { home, draw, away };
}

function emptyLogLoss(): LogLoss {
    return { matches: 0, model: 0, sharpEarly: 0, sharpClosing: 0 };
}

function averaged(sum: LogLoss): LogLoss {
    const n = Math.max(sum.matches, 1);
    return {
        matches: sum.matches,
        model: sum.model / n,
        sharpEarly: sum.sharpEarly / n,
        sharpClosing: sum.sharpClosing / n,
    };
}

function meanOf(values: readonly number[]): number | undefined {
    return values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : undefined;
}
