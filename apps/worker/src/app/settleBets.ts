import type { Config } from "@closing-line/config";
import { matchFixture, settle1x2, settlesFromScore, toOutcome } from "@closing-line/core";
import type { Fixture, Repositories } from "@closing-line/db";
import * as zod from "zod";
import { messageOf } from "../lib/errors.ts";
import type { MatchResultInfo, ResultsSource } from "../ports/results.ts";
import { signedKroner } from "./format.ts";

const HOUR_MS = 3_600_000;
/** A match is over (with stoppage time and a margin) this long after kickoff. */
const FINISHED_AFTER_MS = 2.25 * HOUR_MS;
/** Called-off matches and matches without a result are void after this long. */
const VOID_AFTER_MS = 48 * HOUR_MS;
/**
 * A match still missing from the results feed this long after kickoff is a name or date mismatch, not a late
 * result (a late one is listed as pending): the owner is told once, in time to pin the name before it is voided.
 */
const ALERT_UNMATCHED_AFTER_MS = 6 * HOUR_MS;
const ALERTED_KEY = "unmatched_alerted";
/** A match the results feed still shows as not finished this long after kickoff is stuck there. */
const STUCK_AFTER_MS = 6 * HOUR_MS;
/** Look back this far for fixtures still waiting for a result. */
const LOOKBACK_MS = 7 * 24 * HOUR_MS;
const KICKOFF_TOLERANCE_MS = 3 * HOUR_MS;
/**
 * Leagues without a football-data.org code settle from The Odds API's scores, which cost credits, so they are
 * asked once a day, in the hourly run at 22:xx UTC. That run (from 22:15) covers kickoffs up to about 20:00 UTC,
 * because a match only counts as over 2h15 after kickoff; a later kickoff settles in the next day's run.
 */
const SCORES_HOUR_UTC = 22;

export interface SettleBetsDeps {
    results: ResultsSource;
    /** Recent scores of a league from The Odds API; undefined when the credit guard says no. */
    scores: (league: string) => Promise<MatchResultInfo[] | undefined>;
    repos: Pick<Repositories, "fixtures" | "bets" | "players" | "state">;
    config: Pick<Config, "leagues">;
    now: () => Date;
    notify: (message: string) => Promise<void>;
}

export interface SettleReport {
    fixtures: number;
    settledBets: number;
    /** Fixtures past kickoff with no matching result yet. */
    unmatched: string[];
}

/**
 * Settles every open bet on fixtures that should be over: finished matches by their regular-time score, and
 * matches called off (or never reported) for 48 hours as void. A settled fixture is never settled again. Only
 * match-result (`h2h`) bets settle from the score. A league whose results can't be fetched doesn't stop the
 * others: what did settle is still reported, then the run fails naming each league that didn't.
 */
export async function settleBets(deps: SettleBetsDeps): Promise<SettleReport> {
    const now = deps.now();
    const due = await deps.repos.fixtures.between(
        new Date(now.getTime() - LOOKBACK_MS),
        new Date(now.getTime() - FINISHED_AFTER_MS),
        "scheduled",
    );
    const report: SettleReport = { fixtures: 0, settledBets: 0, unmatched: [] };
    const lines: string[] = [];
    const failures: string[] = [];
    const names = new Map((await deps.repos.players.list()).map((player) => [player.id, player.name]));
    const stored = zod.array(zod.string()).safeParse(await deps.repos.state.get(ALERTED_KEY));
    const alerted = new Set(stored.success ? stored.data : []);
    const alerts: string[] = [];

    for (const league of deps.config.leagues) {
        const fixtures = due.filter((fixture) => fixture.league === league.oddsApiKey);
        if (fixtures.length === 0) continue;

        let results: MatchResultInfo[] | undefined;
        try {
            results = await resultsFor(deps, league, fixtures, now);
        } catch (error) {
            failures.push(`${league.name}: ${messageOf(error)}`);
            continue;
        }
        if (!results) continue;

        const settle = async (fixture: Fixture) => {
            report.fixtures++;
            const settled = await settleFixtureBets(deps, fixture.id, now, names);
            report.settledBets += settled.length;
            lines.push(...settled.map((line) => `${line} on ${fixture.homeTeam} v ${fixture.awayTeam}`));
        };
        // Listed but still not finished well after full time: the feed is stuck on the match.
        const stuck: Fixture[] = [];

        for (const fixture of fixtures) {
            const result = matchFixture(fixture, results, KICKOFF_TOLERANCE_MS);
            const sinceKickoff = now.getTime() - fixture.kickoff.getTime();
            if (await recordFinished(deps, fixture, result)) {
                await settle(fixture);
            } else if (sinceKickoff > VOID_AFTER_MS && (result?.status === "called_off" || !result)) {
                await deps.repos.fixtures.setResult(fixture.id, { status: "void" });
                await settle(fixture);
            } else if (!result) {
                report.unmatched.push(`${fixture.homeTeam} v ${fixture.awayTeam}`);
                if (sinceKickoff >= ALERT_UNMATCHED_AFTER_MS && !alerted.has(fixture.id)) {
                    alerted.add(fixture.id);
                    alerts.push(`${fixture.homeTeam} v ${fixture.awayTeam} (${league.name})`);
                }
            } else if (result.status === "pending" && sinceKickoff >= STUCK_AFTER_MS) {
                stuck.push(fixture);
            }
        }

        // football-data.org sometimes leaves a played match "in play" for days. The Odds API's scores are the
        // backup: asked only in the daily scores run and only for a league with a stuck match, so 2 credits at most.
        if (stuck.length > 0 && league.footballDataCode && now.getUTCHours() === SCORES_HOUR_UTC) {
            const backup = (await deps.scores(league.oddsApiKey)) ?? [];
            for (const fixture of stuck) {
                if (await recordFinished(deps, fixture, matchFixture(fixture, backup, KICKOFF_TOLERANCE_MS))) {
                    await settle(fixture);
                }
            }
        }
    }

    if (lines.length > 0) await deps.notify(`📒 Settled ${lines.length} paper bet(s):\n${lines.join("\n")}`);
    if (alerts.length > 0) {
        await deps.notify(
            `⚠️ No result found for ${alerts.join(", ")}. The results feed probably names a team differently. ` +
                "Pin the name in PINNED_NAMES (packages/core/src/teams.ts) within 48 hours of kickoff, or its bets are voided.",
        );
        // Only fixtures still waiting are kept, so the list stays small.
        const waiting = new Set(due.map((fixture) => fixture.id));
        await deps.repos.state.set(
            ALERTED_KEY,
            [...alerted].filter((fixtureId) => waiting.has(fixtureId)),
        );
    }
    if (failures.length > 0) throw new Error(failures.join("; "));
    return report;
}

/** The league's results around the fixtures' kickoffs, or undefined when it isn't asked this run. */
async function resultsFor(
    deps: SettleBetsDeps,
    league: Config["leagues"][number],
    fixtures: readonly Fixture[],
    now: Date,
): Promise<MatchResultInfo[] | undefined> {
    if (league.footballDataCode) {
        const kickoffs = fixtures.map((fixture) => fixture.kickoff.getTime());
        return deps.results.results(
            league.footballDataCode,
            new Date(Math.min(...kickoffs) - 24 * HOUR_MS),
            new Date(Math.max(...kickoffs) + 24 * HOUR_MS),
        );
    }
    if (now.getUTCHours() !== SCORES_HOUR_UTC) return undefined;
    // Undefined means no credits: try again tomorrow rather than voiding bets for want of a result.
    return deps.scores(league.oddsApiKey);
}

/** Stores a finished result on the fixture; false when `result` isn't a finished match with a score. */
async function recordFinished(
    deps: SettleBetsDeps,
    fixture: Fixture,
    result: MatchResultInfo | undefined,
): Promise<boolean> {
    if (result?.status !== "finished" || result.homeGoals === null || result.awayGoals === null) return false;
    await deps.repos.fixtures.setResult(fixture.id, {
        status: "finished",
        homeGoals: result.homeGoals,
        awayGoals: result.awayGoals,
    });
    return true;
}

async function settleFixtureBets(
    deps: SettleBetsDeps,
    fixtureId: string,
    now: Date,
    names: ReadonlyMap<string, string>,
): Promise<string[]> {
    const fixture = await deps.repos.fixtures.get(fixtureId);
    if (!fixture) return [];
    const result = resultOf(fixture);
    const lines: string[] = [];
    for (const bet of await deps.repos.bets.open([fixtureId])) {
        if (!settlesFromScore(bet)) continue;
        const settlement = settle1x2(
            { selection: toOutcome(bet.selection), stakeOre: bet.stakeOre, decimalOdds: bet.lockedOdds },
            result,
        );
        if (!(await deps.repos.bets.settle(bet.id, { ...settlement, settledAt: now }))) continue;
        lines.push(
            `${names.get(bet.playerId) ?? bet.playerId}: ${settlement.status} ${signedKroner(settlement.profitOre, 0)}`,
        );
    }
    return lines;
}

function resultOf(fixture: Fixture) {
    return fixture.status === "finished" && fixture.homeGoals !== null && fixture.awayGoals !== null
        ? { status: "finished" as const, homeGoals: fixture.homeGoals, awayGoals: fixture.awayGoals }
        : { status: "void" as const };
}
