import { describe, expect, it } from "vitest";
import { fitGoalModel, matchProbabilities, type PlayedMatch } from "../goalModel.ts";

const asOf = new Date("2025-06-01T00:00:00Z");
const options = { halfLifeDays: 365, prior: 0 };
const day = (n: number) => new Date(asOf.getTime() - n * 86_400_000);

/** Mulberry32: a small seeded generator, so the simulated seasons are the same on every run. */
function random(seed: number): () => number {
    let state = seed;
    return () => {
        state = (state + 0x6d2b79f5) | 0;
        let t = Math.imul(state ^ (state >>> 15), 1 | state);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
    };
}

function poisson(rate: number, next: () => number): number {
    let goals = 0;
    let product = next();
    while (product > Math.exp(-rate)) {
        goals++;
        product *= next();
    }
    return goals;
}

/** Double round robins between teams with known log ratings, base 0.1 and home advantage 0.25. */
function simulate(ratings: Record<string, { attack: number; defence: number }>, rounds: number): PlayedMatch[] {
    const next = random(42);
    const teams = Object.keys(ratings);
    const matches: PlayedMatch[] = [];
    for (let round = 0; round < rounds; round++) {
        for (const home of teams) {
            for (const away of teams) {
                if (home === away) continue;
                const h = ratings[home];
                const a = ratings[away];
                if (!h || !a) continue;
                matches.push({
                    home,
                    away,
                    homeGoals: poisson(Math.exp(0.1 + 0.25 + h.attack - a.defence), next),
                    awayGoals: poisson(Math.exp(0.1 + a.attack - h.defence), next),
                    playedAt: day(1 + matches.length / 10),
                });
            }
        }
    }
    return matches;
}

describe("fitGoalModel", () => {
    it("recovers the ratings, base rate and home advantage it was simulated with", () => {
        const ratings = {
            strong: { attack: 0.4, defence: 0.3 },
            good: { attack: 0.15, defence: 0.1 },
            average: { attack: 0, defence: 0 },
            weak: { attack: -0.2, defence: -0.15 },
            poor: { attack: -0.35, defence: -0.25 },
        };
        const model = fitGoalModel(simulate(ratings, 300), asOf, { halfLifeDays: 100_000, prior: 0 });
        expect(model.base).toBeCloseTo(0.1, 1);
        expect(model.home).toBeCloseTo(0.25, 1);
        for (const [team, rating] of Object.entries(ratings)) {
            expect(model.attack.get(team)).toBeCloseTo(rating.attack, 1);
            expect(model.defence.get(team)).toBeCloseTo(rating.defence, 1);
        }
        expect(Math.abs(model.rho)).toBeLessThan(0.1);
    });

    it("ignores matches played on or after the fit date", () => {
        const before: PlayedMatch = { home: "A", away: "B", homeGoals: 1, awayGoals: 1, playedAt: day(10) };
        const later: PlayedMatch = { home: "A", away: "B", homeGoals: 5, awayGoals: 0, playedAt: asOf };
        const withLater = fitGoalModel([before, later], asOf, options);
        expect(withLater).toEqual(fitGoalModel([before], asOf, options));
        expect(() => fitGoalModel([later], asOf, options)).toThrow(RangeError);
    });

    it("weights recent matches more than old ones", () => {
        const old: PlayedMatch[] = Array.from({ length: 10 }, (_, i) => ({
            home: i % 2 === 0 ? "A" : "B",
            away: i % 2 === 0 ? "B" : "A",
            homeGoals: i % 2 === 0 ? 3 : 0,
            awayGoals: i % 2 === 0 ? 0 : 3,
            playedAt: day(700 + i),
        }));
        const recent: PlayedMatch[] = Array.from({ length: 10 }, (_, i) => ({
            home: i % 2 === 0 ? "A" : "B",
            away: i % 2 === 0 ? "B" : "A",
            homeGoals: i % 2 === 0 ? 0 : 3,
            awayGoals: i % 2 === 0 ? 3 : 0,
            playedAt: day(10 + i),
        }));
        const model = fitGoalModel([...old, ...recent], asOf, { halfLifeDays: 90, prior: 1 });
        // B won the recent matches 3-0, A the old ones.
        expect(model.attack.get("B") ?? 0).toBeGreaterThan(model.attack.get("A") ?? 0);
    });

    it("pulls a team with few matches towards average", () => {
        const matches: PlayedMatch[] = [{ home: "A", away: "B", homeGoals: 4, awayGoals: 0, playedAt: day(5) }];
        const loose = fitGoalModel(matches, asOf, { halfLifeDays: 365, prior: 0.1 });
        const tight = fitGoalModel(matches, asOf, { halfLifeDays: 365, prior: 10 });
        expect(Math.abs(tight.attack.get("A") ?? 0)).toBeLessThan(Math.abs(loose.attack.get("A") ?? 0));
    });
});

describe("matchProbabilities", () => {
    const ratings = { strong: { attack: 0.4, defence: 0.3 }, weak: { attack: -0.3, defence: -0.2 } };
    const model = fitGoalModel(simulate(ratings, 40), asOf, { halfLifeDays: 100_000, prior: 1 });

    it("gives probabilities that sum to one and favour the stronger side", () => {
        const probabilities = matchProbabilities(model, "strong", "weak");
        expect(probabilities).toBeDefined();
        const { home = 0, draw = 0, away = 0 } = probabilities ?? {};
        expect(home + draw + away).toBeCloseTo(1, 9);
        expect(home).toBeGreaterThan(0.6);
        expect(away).toBeLessThan(0.15);
    });

    it("gives the home side the edge between equal teams", () => {
        const equal = {
            ...model,
            attack: new Map([
                ["A", 0],
                ["B", 0],
            ]),
            defence: new Map([
                ["A", 0],
                ["B", 0],
            ]),
        };
        const { home = 0, away = 0 } = matchProbabilities(equal, "A", "B") ?? {};
        expect(home).toBeGreaterThan(away);
    });

    it("has no answer for a team it has never seen", () => {
        expect(matchProbabilities(model, "strong", "promoted")).toBeUndefined();
    });
});
