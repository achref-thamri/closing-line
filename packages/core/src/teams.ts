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
 * Clubs where the usual word matching goes wrong, keyed by the odds feed's name (normalized), with the
 * football-data.org names they must equal. "Rennes" shares no word with "Stade Rennais FC 1901" (Rennes v Lille went
 * unsettled on 2026-11-08), and the others are contained in a second club's name: "Barcelona" in "RCD Espanyol de
 * Barcelona", "Paris FC" in "Paris Saint-Germain FC", "Inter Milan" holds "AC Milan".
 */
const PINNED_NAMES: Readonly<Record<string, readonly string[]>> = {
    rennes: ["Stade Rennais FC 1901", "Stade Rennais"],
    barcelona: ["FC Barcelona", "Barça"],
    paris: ["Paris FC"],
    "paris saint germain": ["Paris Saint-Germain FC", "PSG"],
    "inter milan": ["FC Internazionale Milano", "Inter"],
};

const sameWords = (a: readonly string[], b: readonly string[]) =>
    a.length === b.length && a.every((word, i) => word === b[i]);

/**
 * Whether two names mean the same club: equal once normalized, or every word of one appears in the other
 * ("Nottingham" and "Nottingham Forest FC"). Any of `aliases` (e.g. a full and a short name) may match. A name in
 * `PINNED_NAMES` matches only itself or its listed names.
 */
export function sameTeam(name: string, aliases: readonly string[]): boolean {
    const words = normalizeTeam(name);
    const pinned = PINNED_NAMES[words.join(" ")];
    if (pinned) {
        const allowed = [words, ...pinned.map(normalizeTeam)];
        return aliases.some((alias) => allowed.some((option) => sameWords(normalizeTeam(alias), option)));
    }
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
