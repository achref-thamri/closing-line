import type { Outcome } from "@closing-line/core";

/** A finished match the model learns from. */
export interface PlayedMatch {
    home: string;
    away: string;
    homeGoals: number;
    awayGoals: number;
    playedAt: Date;
}

export interface ModelOptions {
    /** Matches lose half their weight every this many days, so recent form counts most. */
    halfLifeDays: number;
    /**
     * Weight of the pull towards an average team, in matches. A team with few matches stays close to average;
     * one with many is judged on its own results.
     */
    prior: number;
}

/**
 * A Dixon-Coles goal model: each side's goals are Poisson with a mean set by its attack, the other side's defence
 * and home advantage, and `rho` corrects how often the low scores 0-0, 1-0, 0-1 and 1-1 happen.
 */
export interface GoalModel {
    /** Log of the goals an average team scores away from home against an average defence. */
    base: number;
    /** Log of the home side's goal multiplier. */
    home: number;
    rho: number;
    /** Log goal multipliers per team: attack raises goals scored, defence lowers goals conceded. */
    attack: ReadonlyMap<string, number>;
    defence: ReadonlyMap<string, number>;
}

const MAX_SWEEPS = 300;
const TOLERANCE = 1e-7;
const MAX_GOALS = 10;
const DAY_MS = 86_400_000;

/**
 * Fits the model on matches played before `asOf`, older matches weighted down by the half-life. The team ratings are
 * the weighted Poisson maximum-likelihood fit, found one parameter at a time (each step has a closed form);
 * `rho` is then chosen by a golden-section search with the ratings fixed.
 */
export function fitGoalModel(matches: readonly PlayedMatch[], asOf: Date, options: ModelOptions): GoalModel {
    const games = matches
        .filter((match) => match.playedAt < asOf)
        .map((match) => ({
            ...match,
            weight: 0.5 ** ((asOf.getTime() - match.playedAt.getTime()) / DAY_MS / options.halfLifeDays),
        }));
    if (games.length === 0) throw new RangeError("The model needs at least one played match");

    const gamesOf = new Map<string, (typeof games)[number][]>();
    for (const game of games) {
        for (const team of [game.home, game.away]) {
            const list = gamesOf.get(team) ?? [];
            list.push(game);
            gamesOf.set(team, list);
        }
    }
    const teams = [...gamesOf.keys()];
    const attack = new Map(teams.map((team) => [team, 0]));
    const defence = new Map(teams.map((team) => [team, 0]));
    const totalWeight = games.reduce((sum, game) => sum + game.weight, 0);
    const goals = games.reduce((sum, game) => sum + game.weight * (game.homeGoals + game.awayGoals), 0);
    const homeGoals = games.reduce((sum, game) => sum + game.weight * game.homeGoals, 0);
    // Goals per side per match: what the prior's pseudo-matches score and concede.
    const average = goals / (2 * totalWeight);
    let base = Math.log(average);
    let home = 0;

    const rating = (ratings: Map<string, number>, team: string) => ratings.get(team) ?? 0;
    for (let sweep = 0; sweep < MAX_SWEEPS; sweep++) {
        let change = 0;
        const update = (ratings: Map<string, number>, team: string, value: number) => {
            change = Math.max(change, Math.abs(value - rating(ratings, team)));
            ratings.set(team, value);
        };

        for (const team of teams) {
            let scored = options.prior * average;
            let expected = options.prior * average;
            for (const game of gamesOf.get(team) ?? []) {
                if (game.home === team) {
                    scored += game.weight * game.homeGoals;
                    expected += game.weight * Math.exp(base + home - rating(defence, game.away));
                } else {
                    scored += game.weight * game.awayGoals;
                    expected += game.weight * Math.exp(base - rating(defence, game.home));
                }
            }
            update(attack, team, Math.log(scored / expected));
        }
        for (const team of teams) {
            let conceded = options.prior * average;
            let expected = options.prior * average;
            for (const game of gamesOf.get(team) ?? []) {
                if (game.home === team) {
                    conceded += game.weight * game.awayGoals;
                    expected += game.weight * Math.exp(base + rating(attack, game.away));
                } else {
                    conceded += game.weight * game.homeGoals;
                    expected += game.weight * Math.exp(base + home + rating(attack, game.home));
                }
            }
            update(defence, team, -Math.log(conceded / expected));
        }

        let homeExpected = 0;
        let allExpected = 0;
        for (const game of games) {
            const homeRate = Math.exp(rating(attack, game.home) - rating(defence, game.away));
            const awayRate = Math.exp(rating(attack, game.away) - rating(defence, game.home));
            homeExpected += game.weight * Math.exp(base) * homeRate;
            allExpected += game.weight * (Math.exp(home) * homeRate + awayRate);
        }
        const nextHome = Math.log(homeGoals / homeExpected);
        const nextBase = Math.log(goals / allExpected);
        change = Math.max(change, Math.abs(nextHome - home), Math.abs(nextBase - base));
        home = nextHome;
        base = nextBase;
        if (change < TOLERANCE) break;
    }

    // Ratings are only fixed up to a shared shift; centre both on zero (an average team) and move the shift into base.
    const meanOf = (ratings: Map<string, number>) =>
        [...ratings.values()].reduce((sum, value) => sum + value, 0) / ratings.size;
    const meanAttack = meanOf(attack);
    const meanDefence = meanOf(defence);
    for (const team of teams) {
        attack.set(team, rating(attack, team) - meanAttack);
        defence.set(team, rating(defence, team) - meanDefence);
    }
    base += meanAttack - meanDefence;

    const rates = games.map((game) => ({
        ...game,
        ...goalRates({ base, home, rho: 0, attack, defence }, game.home, game.away),
    }));
    const logLikelihood = (rho: number) =>
        rates.reduce((sum, game) => sum + game.weight * Math.log(lowScoreFactor(game, rho)), 0);
    const rho = goldenSectionMax(logLikelihood, ...rhoBounds(rates));
    return { base, home, rho, attack, defence };
}

/**
 * The model's home/draw/away probabilities, or undefined when it has no matches for one of the teams.
 */
export function matchProbabilities(model: GoalModel, home: string, away: string): Record<Outcome, number> | undefined {
    if (!model.attack.has(home) || !model.attack.has(away)) return undefined;
    const rates = goalRates(model, home, away);
    const homeGoals = poissonTable(rates.homeRate);
    const awayGoals = poissonTable(rates.awayRate);
    const result = { home: 0, draw: 0, away: 0 };
    let total = 0;
    for (const [x, px] of homeGoals.entries()) {
        for (const [y, py] of awayGoals.entries()) {
            const probability = px * py * lowScoreFactor({ ...rates, homeGoals: x, awayGoals: y }, model.rho);
            total += probability;
            result[x > y ? "home" : x === y ? "draw" : "away"] += probability;
        }
    }
    return { home: result.home / total, draw: result.draw / total, away: result.away / total };
}

function goalRates(model: GoalModel, home: string, away: string) {
    const rating = (ratings: ReadonlyMap<string, number>, team: string) => ratings.get(team) ?? 0;
    return {
        homeRate: Math.exp(model.base + model.home + rating(model.attack, home) - rating(model.defence, away)),
        awayRate: Math.exp(model.base + rating(model.attack, away) - rating(model.defence, home)),
    };
}

/** Dixon and Coles' correction for the four low scores; every other score keeps its Poisson probability. */
function lowScoreFactor(
    game: { homeGoals: number; awayGoals: number; homeRate: number; awayRate: number },
    rho: number,
): number {
    const { homeGoals: x, awayGoals: y, homeRate, awayRate } = game;
    if (x === 0 && y === 0) return 1 - homeRate * awayRate * rho;
    if (x === 0 && y === 1) return 1 + homeRate * rho;
    if (x === 1 && y === 0) return 1 + awayRate * rho;
    if (x === 1 && y === 1) return 1 - rho;
    return 1;
}

/** The range of rho that keeps every low-score factor positive, capped at ±0.3 (fitted values sit near -0.1). */
function rhoBounds(rates: readonly { homeRate: number; awayRate: number }[]): [number, number] {
    let low = -0.3;
    let high = 0.3;
    for (const { homeRate, awayRate } of rates) {
        high = Math.min(high, 1 / (homeRate * awayRate));
        low = Math.max(low, -1 / Math.max(homeRate, awayRate));
    }
    const margin = (high - low) * 1e-3;
    return [low + margin, high - margin];
}

function goldenSectionMax(f: (x: number) => number, low: number, high: number): number {
    const ratio = (Math.sqrt(5) - 1) / 2;
    let a = low;
    let b = high;
    while (b - a > 1e-6) {
        const c = b - ratio * (b - a);
        const d = a + ratio * (b - a);
        if (f(c) > f(d)) b = d;
        else a = c;
    }
    return (a + b) / 2;
}

function poissonTable(rate: number): number[] {
    const table = [Math.exp(-rate)];
    for (let goals = 1; goals <= MAX_GOALS; goals++) table.push(((table[goals - 1] ?? 0) * rate) / goals);
    return table;
}
