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
    }) satisfies zod.ZodType<StakeRules>;

/**
 * Pinnacle as the reference, plus only books with a Danish betting licence, where winnings are tax-free. Checked
 * against Spillemyndigheden's list on 2026-11-08: Unibet, LeoVegas, NordicBet and Betsson, 888 and Marathonbet have
 * one. Casumo and Coolbet don't, so they were dropped. William Hill and 1xBet aren't licensed either. Other licensed
 * brands (Bet365, bwin, Betano, Danske Spil) aren't in The Odds API.
 */
const DEFAULT_BOOKMAKERS = ["pinnacle", "nordicbet", "marathonbet", "betsson", "unibet_se", "leovegas_se", "sport888"];

/** Tunable settings with defaults (spec §2, §5, §6). Money is in kroner. `prefault` runs nested defaults too. */
export const settingsSchema = zod
    .strictObject({
        leagues: zod
            .array(leagueSchema)
            .min(1)
            // More leagues, more chances for value (owner, 2026-11-02; ADR 0008 picked them by back-test). All have
            // Pinnacle on the free plan. Serie B and the Belgian Pro League (added 2026-11-15) have no free
            // football-data.org results, so they settle from The Odds API's scores, once a day for 2 credits.
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
        /**
         * Commission on net winnings per exchange in `bookmakers`, e.g. { "betfair_ex_eu": 0.05 }. Empty while the
         * feed has no exchange (dropped 2026-11-02).
         */
        exchangeCommission: zod.record(zod.string(), zod.number().min(0).max(0.2)).default({}),
        scanner: zod
            .strictObject({
                // 2% since 2026-11-02 (owner): more tips, still clear of price noise; the record decides later.
                minEdge: zod.number().gt(0).lt(1).default(0.02),
                maxSharpAgeMinutes: zod.int().positive().default(10),
                // 72 h from 2026-11-06, a week since 2026-11-21: early prices held up live, best at 3-7 days out
                // (ADR 0008). Further out Pinnacle's line is thin and the record is weakest.
                maxHoursToKickoff: zod.int().positive().default(168),
                // Outsiders don't beat the close: in four past seasons, tips at odds of 5+ averaged -1.6% CLV against
                // +2.8% below 5, and the first live week agreed (-7.2%, 3 of 9). Pinnacle's early outsider prices are
                // too rough to price an edge against (ADR 0008, 2026-11-08).
                maxFairOdds: zod.number().gt(1).default(5),
                // An edge must be big enough for its odds: Kelly fraction of 2% or more. Smaller ones had no edge at
                // Danish-licensed books, in past seasons and live. Draws are the exception: at 1-2% they still beat
                // the close (+1.9% CLV over 63 past tips), and at 2% almost none qualify (ADR 0008, 2026-11-09).
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
        bettors: zod
            .strictObject({
                maxBankrollFraction: fraction.default(0.05),
                /** Large enough that the friend's usual 3,000 kr stakes fit the cap (owner, 2026-11-02). */
                startingBankroll: zod.number().positive().default(60_000),
            })
            .prefault({}),
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
