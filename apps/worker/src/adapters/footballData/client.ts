import * as zod from "zod";
import { getJson, type Fetch } from "../../lib/http.ts";
import { retry, type RetryOptions } from "../../lib/retry.ts";
import type { MatchResultInfo, ResultStatus, ResultsSource } from "../../ports/results.ts";

const BASE_URL = "https://api.football-data.org/v4";

const goals = zod.object({ home: zod.int().nullable(), away: zod.int().nullable() });
const teamSchema = zod.object({ name: zod.string().nullable(), shortName: zod.string().nullable() });
const matchesSchema = zod.object({
    matches: zod.array(
        zod.object({
            utcDate: zod.iso.datetime(),
            status: zod.string(),
            homeTeam: teamSchema,
            awayTeam: teamSchema,
            score: zod.object({ fullTime: goals, regularTime: goals.optional() }),
        }),
    ),
});

/** football-data.org statuses: TIMED, IN_PLAY, FINISHED, AWARDED, POSTPONED, CANCELLED, SUSPENDED and others. */
function statusOf(status: string): ResultStatus {
    if (status === "FINISHED" || status === "AWARDED") return "finished";
    if (status === "POSTPONED" || status === "CANCELLED" || status === "SUSPENDED") return "called_off";
    return "pending";
}

export interface FootballDataOptions {
    token: string;
    fetch?: Fetch;
    retry?: RetryOptions;
}

/** Results from football-data.org (free plan: 10 requests a minute, top competitions only). */
export class FootballDataClient implements ResultsSource {
    private readonly options: FootballDataOptions;

    constructor(options: FootballDataOptions) {
        this.options = options;
    }

    async results(competition: string, from: Date, to: Date): Promise<MatchResultInfo[]> {
        const url = new URL(`${BASE_URL}/competitions/${competition}/matches`);
        url.searchParams.set("dateFrom", from.toISOString().slice(0, 10));
        url.searchParams.set("dateTo", to.toISOString().slice(0, 10));
        const { data } = await retry(
            () =>
                getJson({
                    url,
                    headers: { "X-Auth-Token": this.options.token },
                    schema: matchesSchema,
                    label: `football-data ${competition} matches`,
                    ...(this.options.fetch && { fetch: this.options.fetch }),
                }),
            this.options.retry,
        );
        return data.matches.map((match) => {
            // Regular time is only reported separately when a match went to extra time.
            const score = match.score.regularTime ?? match.score.fullTime;
            return {
                kickoff: new Date(match.utcDate),
                home: names(match.homeTeam),
                away: names(match.awayTeam),
                status: statusOf(match.status),
                homeGoals: score.home,
                awayGoals: score.away,
            };
        });
    }
}

function names(team: zod.output<typeof teamSchema>): string[] {
    return [team.name, team.shortName].filter((name): name is string => name !== null && name !== "");
}
