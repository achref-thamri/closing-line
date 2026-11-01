import { sql } from "drizzle-orm";
import {
    boolean,
    check,
    doublePrecision,
    index,
    integer,
    pgEnum,
    pgTable,
    text,
    timestamp,
    uniqueIndex,
    uuid,
} from "drizzle-orm/pg-core";

const timestamps = {
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
};

export const playerKind = pgEnum("player_kind", ["human", "scanner", "shadow", "benchmark"]);
export const fixtureStatus = pgEnum("fixture_status", ["scheduled", "finished", "void"]);
export const snapshotKind = pgEnum("snapshot_kind", ["poll", "on_demand", "closing"]);
export const betStatus = pgEnum("bet_status", ["open", "won", "lost", "void"]);

/** Everyone with a virtual bankroll: humans, the scanner, the shadow player and benchmarks. */
export const players = pgTable("players", {
    id: text().primaryKey(),
    name: text().notNull(),
    kind: playerKind().notNull(),
    startingBankrollOre: integer("starting_bankroll_ore").notNull(),
    telegramChatId: text("telegram_chat_id"),
    ...timestamps,
});

/** Matches, keyed by The Odds API event id. */
export const fixtures = pgTable(
    "fixtures",
    {
        id: text().primaryKey(),
        league: text().notNull(),
        homeTeam: text("home_team").notNull(),
        awayTeam: text("away_team").notNull(),
        kickoff: timestamp({ withTimezone: true }).notNull(),
        status: fixtureStatus().notNull().default("scheduled"),
        homeGoals: integer("home_goals"),
        awayGoals: integer("away_goals"),
        ...timestamps,
        updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => [
        index("fixtures_kickoff_idx").on(table.kickoff),
        check(
            "fixtures_score_when_finished",
            sql`(${table.status} = 'finished') = (${table.homeGoals} is not null and ${table.awayGoals} is not null)`,
        ),
    ],
);

/** Every price we have seen. Grows fastest; partition by month once it passes a few million rows. */
export const oddsSnapshots = pgTable(
    "odds_snapshots",
    {
        id: integer().primaryKey().generatedAlwaysAsIdentity(),
        fixtureId: text("fixture_id")
            .notNull()
            .references(() => fixtures.id),
        bookmaker: text().notNull(),
        market: text().notNull(),
        selection: text().notNull(),
        price: doublePrecision().notNull(),
        /** When the bookmaker last changed the price, as reported by the API. */
        bookmakerUpdatedAt: timestamp("bookmaker_updated_at", { withTimezone: true }).notNull(),
        takenAt: timestamp("taken_at", { withTimezone: true }).notNull(),
        kind: snapshotKind().notNull(),
    },
    (table) => [
        index("odds_snapshots_fixture_taken_idx").on(table.fixtureId, table.takenAt),
        check("odds_snapshots_price_above_one", sql`${table.price} > 1`),
    ],
);

/** Paper bets. Money is in øre; odds are decimal. */
export const bets = pgTable(
    "bets",
    {
        id: uuid().primaryKey(),
        playerId: text("player_id")
            .notNull()
            .references(() => players.id),
        fixtureId: text("fixture_id")
            .notNull()
            .references(() => fixtures.id),
        market: text().notNull(),
        selection: text().notNull(),
        stakeOre: integer("stake_ore").notNull(),
        lockedOdds: doublePrecision("locked_odds").notNull(),
        bookmaker: text().notNull(),
        /** The player's own price, entered before seeing the odds (humans only). */
        fairPriceEntered: doublePrecision("fair_price_entered"),
        sharpFairOddsAtBet: doublePrecision("sharp_fair_odds_at_bet"),
        edgeAtBet: doublePrecision("edge_at_bet"),
        reasonTags: text("reason_tags")
            .array()
            .notNull()
            .default(sql`'{}'`),
        note: text(),
        wouldBetReal: boolean("would_bet_real"),
        selfReported: boolean("self_reported").notNull().default(false),
        status: betStatus().notNull().default("open"),
        closingFairOdds: doublePrecision("closing_fair_odds"),
        /** Provisional from the last pre-kickoff poll until the official closing odds arrive. */
        closingProvisional: boolean("closing_provisional"),
        clv: doublePrecision(),
        profitOre: integer("profit_ore"),
        ...timestamps,
        settledAt: timestamp("settled_at", { withTimezone: true }),
    },
    (table) => [
        uniqueIndex("bets_one_per_selection").on(table.playerId, table.fixtureId, table.market, table.selection),
        index("bets_open_idx")
            .on(table.fixtureId)
            .where(sql`${table.status} = 'open'`),
        check("bets_stake_positive", sql`${table.stakeOre} > 0`),
        check("bets_odds_above_one", sql`${table.lockedOdds} > 1`),
        check("bets_settled_consistently", sql`(${table.status} = 'open') = (${table.settledAt} is null)`),
    ],
);

/** Games a human priced but chose not to bet: training data without selection bias. */
export const passes = pgTable("passes", {
    id: uuid().primaryKey(),
    playerId: text("player_id")
        .notNull()
        .references(() => players.id),
    fixtureId: text("fixture_id")
        .notNull()
        .references(() => fixtures.id),
    market: text().notNull(),
    selection: text(),
    fairPriceEntered: doublePrecision("fair_price_entered"),
    reasonTags: text("reason_tags")
        .array()
        .notNull()
        .default(sql`'{}'`),
    note: text(),
    ...timestamps,
});

/** Credit balance after each paid API call, read from the response headers. */
export const apiUsage = pgTable(
    "api_usage",
    {
        id: integer().primaryKey().generatedAlwaysAsIdentity(),
        provider: text().notNull(),
        takenAt: timestamp("taken_at", { withTimezone: true }).notNull(),
        used: integer().notNull(),
        remaining: integer().notNull(),
        lastCost: integer("last_cost").notNull(),
    },
    (table) => [index("api_usage_provider_taken_idx").on(table.provider, table.takenAt)],
);
