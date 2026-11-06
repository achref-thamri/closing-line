import { sql } from "drizzle-orm";
import {
    bigint,
    boolean,
    jsonb,
    check,
    doublePrecision,
    index,
    integer,
    pgEnum,
    pgTable,
    primaryKey,
    text,
    timestamp,
    uniqueIndex,
    uuid,
} from "drizzle-orm/pg-core";

const timestamps = {
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
};

export const playerKind = pgEnum("player_kind", ["bettor", "scanner", "benchmark"]);
export const fixtureStatus = pgEnum("fixture_status", ["scheduled", "finished", "void"]);
export const snapshotKind = pgEnum("snapshot_kind", ["poll", "on_demand", "closing"]);
export const betStatus = pgEnum("bet_status", ["open", "won", "lost", "void", "cashed_out"]);
export const sport = pgEnum("sport", ["football", "counter_strike"]);
/** Why a bettor took a bet, chosen in Telegram (spec §4). */
export const betTag = pgEnum("bet_tag", ["lineup", "skewed_price", "game_read", "slow_live_price", "value_tip"]);
export const runStatus = pgEnum("run_status", ["running", "succeeded", "skipped", "failed"]);
/** What the scanner did with a match at a poll: bet, or pass and why. */
export const decisionOutcome = pgEnum("decision_outcome", ["bet", "pass"]);
export const decisionReason = pgEnum("decision_reason", [
    "value",
    "no_edge",
    "no_fresh_sharp",
    "stake_too_small",
    "paused",
    "already_bet",
    "too_early",
]);
/** What a Telegram chat is in the middle of: entering a bet, waiting to be let in, or giving a cash-out amount. */
export const chatSessionKind = pgEnum("chat_session_kind", ["bet_draft", "join_request", "cashout"]);

/** Everyone with a virtual bankroll: bettors, the scanner and the benchmark. */
export const players = pgTable(
    "players",
    {
        id: text().primaryKey(),
        name: text().notNull(),
        kind: playerKind().notNull(),
        startingBankrollOre: integer("starting_bankroll_ore").notNull(),
        /** One player per chat: the bot finds the bettor by the chat a message came from. */
        telegramChatId: text("telegram_chat_id"),
        tipsMuted: boolean("tips_muted").notNull().default(false),
        ...timestamps,
    },
    (table) => [uniqueIndex("players_telegram_chat_id_unique").on(table.telegramChatId)],
);

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
        /** Null for bets on events we do not track (player props in other leagues, Counter-Strike). */
        fixtureId: text("fixture_id").references(() => fixtures.id),
        sport: sport().notNull().default("football"),
        /** The match as the bettor typed it, e.g. "Aurora – Team Liquid", when no fixture matches. */
        eventName: text("event_name"),
        market: text().notNull(),
        selection: text().notNull(),
        /** Player props: the player and the line, e.g. "Jobe Bellingham" and 1.5 shots on target. */
        playerName: text("player_name"),
        line: doublePrecision(),
        stakeOre: integer("stake_ore").notNull(),
        lockedOdds: doublePrecision("locked_odds").notNull(),
        bookmaker: text().notNull(),
        sharpFairOddsAtBet: doublePrecision("sharp_fair_odds_at_bet"),
        edgeAtBet: doublePrecision("edge_at_bet"),
        selfReported: boolean("self_reported").notNull().default(false),
        tag: betTag(),
        /** When the bettor logged the bet. */
        receivedAt: timestamp("received_at", { withTimezone: true }),
        /** The latest cash-out offer seen; for a cashed-out bet, what it paid. */
        cashoutOfferOre: integer("cashout_offer_ore"),
        /** The bookmaker's price implied by the cash-out offer: the props version of closing odds. */
        impliedCurrentOdds: doublePrecision("implied_current_odds"),
        /** For a cashed-out bet: how the selection itself ended, to compare cashing out with holding. */
        heldStatus: betStatus("held_status"),
        status: betStatus().notNull().default("open"),
        closingFairOdds: doublePrecision("closing_fair_odds"),
        /** True when a better closing source may still replace the value (ADR 0006). */
        closingProvisional: boolean("closing_provisional"),
        clv: doublePrecision(),
        /** A scanner tip: when a later poll found no bookmaker paying the fair price any more. */
        priceGoneAt: timestamp("price_gone_at", { withTimezone: true }),
        profitOre: integer("profit_ore"),
        ...timestamps,
        settledAt: timestamp("settled_at", { withTimezone: true }),
    },
    (table) => [
        uniqueIndex("bets_one_per_selection")
            .on(table.playerId, table.fixtureId, table.market, table.selection)
            .where(sql`not ${table.selfReported}`),
        index("bets_open_idx")
            .on(table.fixtureId)
            .where(sql`${table.status} = 'open'`),
        check("bets_stake_positive", sql`${table.stakeOre} > 0`),
        check("bets_odds_above_one", sql`${table.lockedOdds} > 1`),
        check("bets_settled_consistently", sql`(${table.status} = 'open') = (${table.settledAt} is null)`),
        check("bets_has_event", sql`${table.fixtureId} is not null or ${table.eventName} is not null`),
        check(
            "bets_cashout_has_offer",
            // Compared as text: a new enum value cannot be used in the migration that adds it.
            sql`${table.status}::text <> 'cashed_out' or ${table.cashoutOfferOre} is not null`,
        ),
        check("bets_h2h_selection", sql`${table.market} <> 'h2h' or ${table.selection} in ('home', 'draw', 'away')`),
    ],
);

/**
 * One row per match the scanner looked at in a poll, bet or pass, with the best price it saw and Pinnacle's fair
 * probabilities, so passes can be measured as well as bets (what happened after a pass, calibration).
 */
export const decisions = pgTable(
    "decisions",
    {
        id: integer().primaryKey().generatedAlwaysAsIdentity(),
        fixtureId: text("fixture_id")
            .notNull()
            .references(() => fixtures.id),
        takenAt: timestamp("taken_at", { withTimezone: true }).notNull(),
        minutesToKickoff: integer("minutes_to_kickoff").notNull(),
        outcome: decisionOutcome().notNull(),
        reason: decisionReason().notNull(),
        /** The best soft price on any selection, value or not; null without a fresh Pinnacle price. */
        bestSelection: text("best_selection"),
        bestBookmaker: text("best_bookmaker"),
        bestOdds: doublePrecision("best_odds"),
        bestEdge: doublePrecision("best_edge"),
        fairHome: doublePrecision("fair_home"),
        fairDraw: doublePrecision("fair_draw"),
        fairAway: doublePrecision("fair_away"),
    },
    (table) => [
        index("decisions_taken_idx").on(table.takenAt),
        check("decisions_bet_is_value", sql`(${table.outcome} = 'bet') = (${table.reason} = 'value')`),
    ],
);

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

/** One row per scheduled job run, keyed so a job runs at most once (e.g. `prekickoff:soccer_epl:2026-11-08T14:00`). */
export const jobRuns = pgTable(
    "job_runs",
    {
        key: text().primaryKey(),
        job: text().notNull(),
        status: runStatus().notNull().default("running"),
        message: text(),
        startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
        finishedAt: timestamp("finished_at", { withTimezone: true }),
    },
    (table) => [index("job_runs_started_idx").on(table.startedAt)],
);

/** Small pieces of worker state that must survive restarts, e.g. whether the last run shut down cleanly. */
export const workerState = pgTable("worker_state", {
    key: text().primaryKey(),
    value: jsonb().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Telegram conversations in progress, kept here so a restart or deploy does not lose a half-entered bet (ADR 0009). */
export const chatSessions = pgTable(
    "chat_sessions",
    {
        chatId: bigint("chat_id", { mode: "number" }).notNull(),
        kind: chatSessionKind().notNull(),
        value: jsonb().notNull(),
        updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
    },
    (table) => [primaryKey({ columns: [table.chatId, table.kind] })],
);
