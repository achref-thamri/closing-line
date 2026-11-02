import type { StakeRules } from "@closing-line/core";
import { z } from "zod";

const emptyToUndefined = (value: unknown): unknown => (value === "" ? undefined : value);

const requiredSecret = z.preprocess(emptyToUndefined, z.string({ error: "is required" }).trim().min(1, "is required"));
const optionalSecret = z.preprocess(emptyToUndefined, z.string().trim().min(1).optional());
const chatId = z.coerce.number({ error: "must be an integer chat id" }).int();
const fraction = z.number().gt(0).lte(1);

/** Secrets and deployment settings, read from environment variables. */
export const envSchema = z.object({
    ODDS_API_KEY: requiredSecret,
    FOOTBALL_DATA_TOKEN: requiredSecret,
    TELEGRAM_BOT_TOKEN: requiredSecret,
    TELEGRAM_OWNER_CHAT_ID: z.preprocess(emptyToUndefined, chatId),
    /** Needed from phase 2, when the bot reads bets written in plain language. */
    ANTHROPIC_API_KEY: optionalSecret,
    /** Postgres connection string. Without it the worker uses an embedded PGlite database in `PGLITE_DIR`. */
    DATABASE_URL: z.preprocess(emptyToUndefined, z.url({ protocol: /^postgres(ql)?$/ }).optional()),
    PGLITE_DIR: z.preprocess(emptyToUndefined, z.string().min(1).default("data/pglite")),
    /** Touched every minute by the worker; Docker's health check reads its age. */
    HEARTBEAT_PATH: z.preprocess(emptyToUndefined, z.string().min(1).default("data/heartbeat")),
    HEALTHCHECK_PING_URL: z.preprocess(emptyToUndefined, z.url({ protocol: /^https$/ }).optional()),
    LOG_LEVEL: z.preprocess(
        emptyToUndefined,
        z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
    ),
});

const leagueSchema = z.strictObject({
    /** The Odds API sport key, e.g. `soccer_epl`. */
    oddsApiKey: z.string().min(1),
    /** football-data.org competition code for results; leagues without one settle from The Odds API scores. */
    footballDataCode: z.string().min(1).optional(),
    name: z.string().min(1),
});

const stakeRulesSchema = z
    .strictObject({
        kellyMultiplier: fraction.default(0.25),
        maxBankrollFraction: fraction.default(0.02),
        minStake: z.number().positive().default(50),
        maxStake: z.number().positive().default(500),
        step: z.number().positive().default(10),
    })
    .refine((rules) => rules.minStake <= rules.maxStake, {
        message: "minStake cannot exceed maxStake",
        path: ["minStake"],
    })
    .refine((rules) => rules.minStake % rules.step === 0, {
        message: "minStake must be a multiple of step",
        path: ["minStake"],
    }) satisfies z.ZodType<StakeRules>;

/**
 * Pinnacle as the reference plus books a Danish bettor can use (2026-11-02): the friend's NordicBet and Marathonbet,
 * and Danish-facing brands. Exchanges were dropped; the friend's other books are not in The Odds API.
 */
const DEFAULT_BOOKMAKERS = [
    "pinnacle",
    "nordicbet",
    "marathonbet",
    "betsson",
    "unibet_se",
    "leovegas_se",
    "sport888",
    "casumo",
    "coolbet",
];

/** Tunable settings with defaults (spec §2, §5, §6). Money is in kroner. `prefault` runs nested defaults too. */
export const settingsSchema = z
    .strictObject({
        leagues: z
            .array(leagueSchema)
            .min(1)
            // More leagues, more chances for value (owner, 2026-11-02; ADR 0008 picked them by back-test). All have
            // Pinnacle on the free plan and free results from football-data.org; ~300 credits a month together.
            .default([
                { oddsApiKey: "soccer_epl", footballDataCode: "PL", name: "Premier League" },
                { oddsApiKey: "soccer_efl_champ", footballDataCode: "ELC", name: "Championship" },
                { oddsApiKey: "soccer_germany_bundesliga", footballDataCode: "BL1", name: "Bundesliga" },
                { oddsApiKey: "soccer_spain_la_liga", footballDataCode: "PD", name: "La Liga" },
                { oddsApiKey: "soccer_italy_serie_a", footballDataCode: "SA", name: "Serie A" },
                { oddsApiKey: "soccer_france_ligue_one", footballDataCode: "FL1", name: "Ligue 1" },
            ]),
        /** Up to 10 bookmakers cost one region's worth of credits per call. */
        bookmakers: z.array(z.string().min(1)).min(2).max(10).default(DEFAULT_BOOKMAKERS),
        /** Reference bookmaker whose de-vigged prices count as fair. */
        sharpBookmaker: z.string().min(1).default("pinnacle"),
        /** Commission on net winnings, for exchanges. */
        exchangeCommission: z
            .record(z.string(), z.number().min(0).max(0.2))
            .default({ betfair_ex_eu: 0.05, matchbook: 0.02 }),
        scanner: z
            .strictObject({
                // 2% since 2026-11-02 (owner): more tips, still clear of price noise; the record decides later.
                minEdge: z.number().gt(0).lt(1).default(0.02),
                maxSharpAgeMinutes: z.int().positive().default(10),
                stake: stakeRulesSchema.prefault({}),
            })
            .prefault({}),
        /** Flat stake for the "always back the favourite" benchmark. */
        benchmarkStake: z.number().positive().default(100),
        /** Polls this close to kickoff record closing prices and place the benchmark bet. */
        closingWindowMinutes: z.int().positive().max(180).default(45),
        bettors: z
            .strictObject({
                maxBankrollFraction: fraction.default(0.05),
                /** Large enough that the friend's usual 3,000 kr stakes fit the cap (owner, 2026-11-02). */
                startingBankroll: z.number().positive().default(60_000),
                /** Claude reads per person per day (screenshots and typed bets); caps the Anthropic bill. */
                dailySlipReads: z.int().positive().default(30),
            })
            .prefault({}),
        startingBankroll: z.number().positive().default(10_000),
        /** A player that loses this share of its bankroll in a week pauses until Monday. */
        weeklyLossPause: fraction.default(0.15),
        credits: z
            .strictObject({
                /** Credits kept back for manual tests; the bot stops polling at this level. */
                reserve: z.int().min(0).default(50),
                /** Usage shares that trigger a Telegram warning. */
                warnAt: z.array(fraction).default([0.7, 0.9]),
            })
            .prefault({}),
        timezone: z.string().min(1).default("Europe/Copenhagen"),
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

export type Settings = z.infer<typeof settingsSchema>;
export type League = z.infer<typeof leagueSchema>;
