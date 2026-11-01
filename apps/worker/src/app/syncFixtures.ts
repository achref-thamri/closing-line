import type { Config } from "@betting/config";
import type { Repositories } from "@betting/db";
import type { OddsSource } from "../ports/odds.ts";
import type { CreditGuard } from "./creditGuard.ts";

export interface SyncFixturesDeps {
    source: Pick<OddsSource, "events">;
    guard: Pick<CreditGuard, "record">;
    repos: Pick<Repositories, "fixtures">;
    config: Pick<Config, "leagues">;
}

/** Stores upcoming fixtures for every league. Free: the events endpoint costs no credits. */
export async function syncFixtures(deps: SyncFixturesDeps): Promise<number> {
    let count = 0;
    for (const league of deps.config.leagues) {
        const { data, balance } = await deps.source.events(league.oddsApiKey);
        await deps.repos.fixtures.upsert(data);
        await deps.guard.record(balance);
        count += data.length;
    }
    return count;
}
