import type { StakeRules } from "@closing-line/core";
import * as zod from "zod";

const emptyToUndefined = (value: unknown): unknown => (value === "" ? undefined : value);

const requiredSecret = zod.preprocess(
    emptyToUndefined,
    zod.string({ error: "is required" }).trim().min(1, "is required"),
);
const chatId = zod.coerce.number({ error: "must be an integer chat id" }).int();
const fraction = zod.number().gt(0).lte(1);

/** Secrets and deployment settings, read from environment variables. */
export const envSchema = zod.object({
    ODDS_API_KEY: requiredSecret,
    FOOTBALL_DATA_TOKEN: requiredSecret,
    TELEGRAM_BOT_TOKEN: requiredSecret,
    TELEGRAM_OWNER_CHAT_ID: zod.preprocess(emptyToUndefined, chatId),
    /** Postgres connection string. Without it the worker uses an embedded PGlite database in `PGLITE_DIR`. */
    DATABASE_URL: zod.preprocess(emptyToUndefined, zod.url({ protocol: /^postgres(ql)?$/ }).optional()),
    PGLITE_DIR: zod.preprocess(emptyToUndefined, zod.string().min(1).default("data/pglite")),
    /** Touched every minute by the worker; Docker's health check reads its age. */
    HEARTBEAT_PATH: zod.preprocess(emptyToUndefined, zod.string().min(1).default("data/heartbeat")),
    HEALTHCHECK_PING_URL: zod.preprocess(emptyToUndefined, zod.url({ protocol: /^https$/ }).optional()),
    BACKUP_PING_URL: zod.preprocess(emptyToUndefined, zod.url({ protocol: /^https$/ }).optional()),
    LOG_LEVEL: zod.preprocess(
        emptyToUndefined,
        zod.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
    ),
});

const leagueSchema = zod.strictObject({
    /** The Odds API sport key, e.g. `soccer_epl`. */
    oddsApiKey: zod.string().min(1),
    /** football-data.org competition code for results; leagues without one settle from The Odds API scores. */
    footballDataCode: zod.string().min(1).optional(),
    name: zod.string().min(1),
});

const stakeRulesSchema = zod
    .strictObject({
        kellyMultiplier: fraction.default(0.25),
        maxBankrollFraction: fraction.default(0.02),
        minStake: zod.number().positive().default(50),
        maxStake: zod.number().positive().default(500),
        step: zod.number().positive().default(10),
    })
    .refine((rules) => rules.minStake <= rules.maxStake, {
        message: "minStake cannot exceed maxStake",
        path: ["minStake"],
    })
    .refine((rules) => rules.minStake % rules.step === 0, {
        message: "minStake must be a multiple of step",
        path: ["minStake"],
    })
    // The cap is applied after rounding to the step, so an odd cap would give an odd stake.
    .refine((rules) => rules.maxStake % rules.step === 0, {
        message: "maxStake must be a multiple of step",
        path: ["maxStake"],
    }) satisfies zod.ZodType<StakeRules>;

/** Pinnacle as the reference, plus the two books bets are actually placed at, so every tip is one that can be taken. */
const DEFAULT_BOOKMAKERS = ["pinnacle", "unibet_se", "leovegas_se"];

/** Tunable settings with defaults. Money is in kroner. `prefault` runs nested defaults too. */
export const settingsSchema = zod
    .strictObject({
        leagues: zod
            .array(leagueSchema)
            .min(1)
            // Picked by back-test (docs/scanner-rules.md); all have Pinnacle on the free plan. Serie B and the
            // Belgian Pro League have no free football-data.org results, so they settle from The Odds API's scores.
            .default([
                { oddsApiKey: "soccer_epl", footballDataCode: "PL", name: "Premier League" },
                { oddsApiKey: "soccer_efl_champ", footballDataCode: "ELC", name: "Championship" },
                { oddsApiKey: "soccer_germany_bundesliga", footballDataCode: "BL1", name: "Bundesliga" },
                { oddsApiKey: "soccer_spain_la_liga", footballDataCode: "PD", name: "La Liga" },
                { oddsApiKey: "soccer_italy_serie_a", footballDataCode: "SA", name: "Serie A" },
                { oddsApiKey: "soccer_france_ligue_one", footballDataCode: "FL1", name: "Ligue 1" },
                { oddsApiKey: "soccer_italy_serie_b", name: "Serie B" },
                { oddsApiKey: "soccer_belgium_first_div", name: "Belgian Pro League" },
            ]),
        /** Up to 10 bookmakers cost one region's worth of credits per call. */
        bookmakers: zod.array(zod.string().min(1)).min(2).max(10).default(DEFAULT_BOOKMAKERS),
        /** Reference bookmaker whose de-vigged prices count as fair. */
        sharpBookmaker: zod.string().min(1).default("pinnacle"),
        /** Commission on net winnings per exchange in `bookmakers`, e.g. { "betfair_ex_eu": 0.05 }. */
        exchangeCommission: zod.record(zod.string(), zod.number().min(0).max(0.2)).default({}),
        scanner: zod
            .strictObject({
                // The edge over Pinnacle's fair price a tip needs (docs/scanner-rules.md).
                minEdge: zod.number().gt(0).lt(1).default(0.02),
                maxSharpAgeMinutes: zod.int().positive().default(10),
                // Further out than a week, Pinnacle's line is thin and early tips have the weakest record
                // (docs/scanner-rules.md).
                maxHoursToKickoff: zod.int().positive().default(168),
                // Outsiders don't beat the close, in past seasons or live (docs/scanner-rules.md).
                maxFairOdds: zod.number().gt(1).default(5),
                // Longer odds need a bigger edge. Draws get a lower bar: at 2% almost none qualify, and at 1-2% they
                // still beat the close (docs/scanner-rules.md).
                minKellyFraction: zod
                    .strictObject({ home: fraction, draw: fraction, away: fraction })
                    .default({ home: 0.02, draw: 0.01, away: 0.02 }),
                stake: stakeRulesSchema.prefault({}),
            })
            .prefault({}),
        /** Flat stake for the "always back the favourite" benchmark. */
        benchmarkStake: zod.number().positive().default(100),
        /** Polls this close to kickoff record closing prices and place the benchmark bet. */
        closingWindowMinutes: zod.int().positive().max(180).default(45),
        // Bettors who log their own bets in Telegram; each gets this paper bankroll.
        bettors: zod
            .strictObject({
                maxBankrollFraction: fraction.default(0.05),
                /** Large enough that a usual 3,000 kr stake fits under `maxBankrollFraction`. */
                startingBankroll: zod.number().positive().default(60_000),
            })
            .prefault({}),
        /** Paper bankroll of the scanner and the favourite benchmark, in kroner. */
        startingBankroll: zod.number().positive().default(10_000),
        /** The scanner stops betting while its losses over the last seven days are above this share of its bankroll. */
        weeklyLossPause: fraction.default(0.15),
        credits: zod
            .strictObject({
                /** Routine polls stop at this level; the rest is kept for closing prices and scores. */
                reserve: zod.int().min(0).default(50),
                /** Usage shares that trigger a Telegram warning. */
                warnAt: zod.array(fraction).default([0.7, 0.9]),
            })
            .prefault({}),
        timezone: zod.string().min(1).default("Europe/Copenhagen"),
    })
    .refine((settings) => settings.bookmakers.includes(settings.sharpBookmaker), {
        message: "sharpBookmaker must be one of bookmakers",
        path: ["sharpBookmaker"],
    })
    .refine((settings) => isTimeZone(settings.timezone), {
        message: "is not a valid IANA time zone",
        path: ["timezone"],
    });

function isTimeZone(timeZone: string): boolean {
    try {
        new Intl.DateTimeFormat("en", { timeZone });
        return true;
    } catch {
        return false;
    }
}

export type Settings = zod.infer<typeof settingsSchema>;
export type League = zod.infer<typeof leagueSchema>;
