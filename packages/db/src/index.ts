export { openDatabase } from "./client.ts";
export type { Database, DatabaseHandle, DatabaseTarget } from "./client.ts";
export { createRepositories } from "./repositories.ts";
export type {
    ApiUsage,
    Bet,
    Fixture,
    FixtureResult,
    NewBet,
    NewFixture,
    NewOddsSnapshot,
    NewPlayer,
    OddsSnapshot,
    Player,
    Repositories,
} from "./repositories.ts";
export * as schema from "./schema.ts";
