import { teamsOf } from "./picks.ts";

/** Words that only say "football club" and differ between data sources. */
const FILLER = new Set(["fc", "afc", "cf", "sc", "ac", "the"]);

/** Lower case, no accents or punctuation, "&" as "and", without filler words like "FC". */
export function normalizeTeam(name: string): string[] {
    return name
        .normalize("NFD")
        .replace(/\p{Diacritic}/gu, "")
        .toLowerCase()
        .replaceAll("&", " and ")
        .replace(/[^a-z0-9 ]/g, " ")
        .split(/\s+/)
        .filter((word) => word !== "" && !FILLER.has(word));
}

/**
 * Whether two names mean the same club: equal once normalized, or every word of one appears in the other
 * ("Nottingham" and "Nottingham Forest FC"). Any of `aliases` (e.g. a full and a short name) may match.
 */
export function sameTeam(name: string, aliases: readonly string[]): boolean {
    const words = normalizeTeam(name);
    return aliases.some((alias) => {
        const other = normalizeTeam(alias);
        if (words.length === 0 || other.length === 0) return false;
        const [shorter, longer] = words.length <= other.length ? [words, other] : [other, words];
        return shorter.every((word) => longer.includes(word));
    });
}

export interface ResultCandidate {
    kickoff: Date;
    home: readonly string[];
    away: readonly string[];
}

/** The candidate with both teams matching and a kickoff within `toleranceMs`, or nothing if none or several. */
export function matchFixture<T extends ResultCandidate>(
    fixture: { homeTeam: string; awayTeam: string; kickoff: Date },
    candidates: readonly T[],
    toleranceMs: number,
): T | undefined {
    const matches = candidates.filter(
        (candidate) =>
            Math.abs(candidate.kickoff.getTime() - fixture.kickoff.getTime()) <= toleranceMs &&
            sameTeam(fixture.homeTeam, candidate.home) &&
            sameTeam(fixture.awayTeam, candidate.away),
    );
    return matches.length === 1 ? matches[0] : undefined;
}

/**
 * The one fixture a typed match names, home side first as bookmakers list it ("Bayern – Arsenal" for Bayern
 * München v Arsenal); nothing when the text does not split into two teams, or when none or several fit.
 */
export function fixtureNamed<T extends { homeTeam: string; awayTeam: string }>(
    eventName: string,
    fixtures: readonly T[],
): T | undefined {
    const [home, away] = teamsOf(eventName);
    if (!home || !away) return undefined;
    const matches = fixtures.filter(
        (fixture) => sameTeam(home, [fixture.homeTeam]) && sameTeam(away, [fixture.awayTeam]),
    );
    return matches.length === 1 ? matches[0] : undefined;
}
