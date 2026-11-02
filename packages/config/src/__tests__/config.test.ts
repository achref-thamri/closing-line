import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ConfigError, loadConfig, parseConfig } from "../index.ts";

const env = {
    ODDS_API_KEY: "odds-key",
    FOOTBALL_DATA_TOKEN: "fd-token",
    TELEGRAM_BOT_TOKEN: "123:abc",
    TELEGRAM_OWNER_CHAT_ID: "42",
};

function problemsOf(run: () => unknown): string {
    try {
        run();
    } catch (error) {
        expect(error).toBeInstanceOf(ConfigError);
        return (error as Error).message;
    }
    throw new Error("expected a ConfigError");
}

describe("parseConfig", () => {
    it("fills in every default from the spec", () => {
        const config = parseConfig(env);
        expect(config.leagues.map((league) => [league.oddsApiKey, league.footballDataCode])).toEqual([
            ["soccer_epl", "PL"],
            ["soccer_efl_champ", "ELC"],
            ["soccer_germany_bundesliga", "BL1"],
            ["soccer_spain_la_liga", "PD"],
        ]);
        expect(config.bookmakers).toHaveLength(10);
        expect(config.sharpBookmaker).toBe("pinnacle");
        expect(config.exchangeCommission).toEqual({ betfair_ex_eu: 0.05, matchbook: 0.02 });
        expect(config.scanner).toEqual({
            minEdge: 0.02,
            maxSharpAgeMinutes: 10,
            stake: { kellyMultiplier: 0.25, maxBankrollFraction: 0.02, minStake: 50, maxStake: 500, step: 10 },
        });
        expect(config.humans.maxBankrollFraction).toBe(0.05);
        expect(config.benchmarkStake).toBe(100);
        expect(config.closingWindowMinutes).toBe(45);
        expect(config.credits).toEqual({ reserve: 50, warnAt: [0.7, 0.9] });
        expect(config.timezone).toBe("Europe/Copenhagen");
        expect(config.telegram).toEqual({ botToken: "123:abc", ownerChatId: 42, friendChatId: undefined });
        expect(config.logLevel).toBe("info");
        expect(config.heartbeatPath).toBe("data/heartbeat");
    });

    it("uses embedded PGlite without a database URL and Postgres with one", () => {
        expect(parseConfig(env).database).toEqual({ kind: "pglite", dir: "data/pglite" });
        expect(parseConfig({ ...env, DATABASE_URL: "postgres://bot:pw@db:5432/closing_line" }).database).toEqual({
            kind: "postgres",
            url: "postgres://bot:pw@db:5432/closing_line",
        });
    });

    it("treats empty variables as unset", () => {
        const config = parseConfig({ ...env, TELEGRAM_FRIEND_CHAT_ID: "", DATABASE_URL: "", LOG_LEVEL: "" });
        expect(config.telegram.friendChatId).toBeUndefined();
        expect(config.database.kind).toBe("pglite");
        expect(config.logLevel).toBe("info");
    });

    it("merges partial nested settings with the defaults", () => {
        const config = parseConfig(env, { scanner: { minEdge: 0.05, stake: { maxStake: 300 } } });
        expect(config.scanner.minEdge).toBe(0.05);
        expect(config.scanner.maxSharpAgeMinutes).toBe(10);
        expect(config.scanner.stake.maxStake).toBe(300);
        expect(config.scanner.stake.minStake).toBe(50);
    });

    it("lists every problem at once", () => {
        const message = problemsOf(() =>
            parseConfig(
                { ...env, ODDS_API_KEY: " ", TELEGRAM_OWNER_CHAT_ID: "me", DATABASE_URL: "mysql://x" },
                { sharpBookmaker: "bet365", timezone: "Mars/Olympus", extra: true },
            ),
        );
        expect(message).toContain("env ODDS_API_KEY: is required");
        expect(message).toContain("env TELEGRAM_OWNER_CHAT_ID");
        expect(message).toContain("env DATABASE_URL");
        expect(message).toContain("settings sharpBookmaker: sharpBookmaker must be one of bookmakers");
        expect(message).toContain("settings timezone: is not a valid IANA time zone");
        expect(message).toContain("extra");
    });

    it("rejects more than ten bookmakers, which would double the credit cost", () => {
        const bookmakers = Array.from({ length: 11 }, (_, i) => (i === 0 ? "pinnacle" : `book${i}`));
        expect(problemsOf(() => parseConfig(env, { bookmakers }))).toContain("settings bookmakers");
    });

    it("rejects stake rules that cannot produce a stake", () => {
        expect(problemsOf(() => parseConfig(env, { scanner: { stake: { minStake: 600 } } }))).toContain(
            "minStake cannot exceed maxStake",
        );
        expect(problemsOf(() => parseConfig(env, { scanner: { stake: { minStake: 55 } } }))).toContain(
            "minStake must be a multiple of step",
        );
    });
});

describe("loadConfig", () => {
    it("reads settings from the JSON file at CONFIG_PATH", () => {
        const path = join(mkdtempSync(join(tmpdir(), "config-")), "settings.json");
        writeFileSync(path, JSON.stringify({ startingBankroll: 5000 }));
        expect(loadConfig({ ...env, CONFIG_PATH: path }).startingBankroll).toBe(5000);
    });

    it("works without a settings file", () => {
        expect(loadConfig(env).startingBankroll).toBe(10_000);
    });

    it("reports an unreadable settings file", () => {
        expect(problemsOf(() => loadConfig({ ...env, CONFIG_PATH: "/nonexistent/settings.json" }))).toContain(
            "Cannot read settings file /nonexistent/settings.json",
        );
    });
});
