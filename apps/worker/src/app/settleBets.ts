import type { Config } from "@closing-line/config";
import { matchFixture, settle1x2, toOutcome } from "@closing-line/core";
import type { Fixture, Repositories } from "@closing-line/db";
import type { ResultsSource } from "../ports/results.ts";

const HOUR_MS = 3_600_000;
/** A match is over (with stoppage time and a margin) this long after kickoff. */
const FINISHED_AFTER_MS = 2.25 * HOUR_MS;
/** Called-off matches and matches without a result are void after this long. */
const VOID_AFTER_MS = 48 * HOUR_MS;
/** Look back this far for fixtures still waiting for a result. */
const LOOKBACK_MS = 7 * 24 * HOUR_MS;
const KICKOFF_TOLERANCE_MS = 3 * HOUR_MS;

export interface SettleBetsDeps {
    results: ResultsSource;
    repos: Pick<Repositories, "fixtures" | "bets" | "players">;
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
 * match-result (`h2h`) bets settle from the score.
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
    const names = new Map((await deps.repos.players.list()).map((player) => [player.id, player.name]));

    for (const league of deps.config.leagues) {
        const fixtures = due.filter((fixture) => fixture.league === league.oddsApiKey);
        if (fixtures.length === 0 || !league.footballDataCode) continue;

        const kickoffs = fixtures.map((fixture) => fixture.kickoff.getTime());
        const results = await deps.results.results(
            league.footballDataCode,
            new Date(Math.min(...kickoffs) - 24 * HOUR_MS),
            new Date(Math.max(...kickoffs) + 24 * HOUR_MS),
        );

        for (const fixture of fixtures) {
            const result = matchFixture(fixture, results, KICKOFF_TOLERANCE_MS);
            const overdue = now.getTime() - fixture.kickoff.getTime() > VOID_AFTER_MS;
            if (result?.status === "finished" && result.homeGoals !== null && result.awayGoals !== null) {
                await deps.repos.fixtures.setResult(fixture.id, {
                    status: "finished",
                    homeGoals: result.homeGoals,
                    awayGoals: result.awayGoals,
                });
            } else if (overdue && (result?.status === "called_off" || !result)) {
                await deps.repos.fixtures.setResult(fixture.id, { status: "void" });
            } else {
                if (!result) report.unmatched.push(`${fixture.homeTeam} v ${fixture.awayTeam}`);
                continue;
            }
            report.fixtures++;
            const settled = await settleFixtureBets(deps, fixture.id, now, names);
            report.settledBets += settled.length;
            lines.push(...settled.map((line) => `${line} — ${fixture.homeTeam} v ${fixture.awayTeam}`));
        }
    }

    if (lines.length > 0) await deps.notify(`📒 Settled ${lines.length} paper bet(s):\n${lines.join("\n")}`);
    return report;
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
        // Other markets on the fixture (a bettor's player props) are settled by the bettor with /open.
        if (bet.market !== "h2h") continue;
        const settlement = settle1x2(
            { selection: toOutcome(bet.selection), stakeOre: bet.stakeOre, decimalOdds: bet.lockedOdds },
            result,
        );
        if (!(await deps.repos.bets.settle(bet.id, { ...settlement, settledAt: now }))) continue;
        const profit = (settlement.profitOre / 100).toFixed(0);
        lines.push(
            `${names.get(bet.playerId) ?? bet.playerId}: ${settlement.status} ${settlement.profitOre >= 0 ? "+" : ""}${profit} kr`,
        );
    }
    return lines;
}

function resultOf(fixture: Fixture) {
    return fixture.status === "finished" && fixture.homeGoals !== null && fixture.awayGoals !== null
        ? { status: "finished" as const, homeGoals: fixture.homeGoals, awayGoals: fixture.awayGoals }
        : { status: "void" as const };
}
