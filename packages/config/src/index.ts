import { readFileSync } from "node:fs";
import type { z } from "zod";
import { envSchema, settingsSchema, type Settings } from "./schema.ts";

export type { League, Settings } from "./schema.ts";

export type LogLevel = "fatal" | "error" | "warn" | "info" | "debug" | "trace";

export interface Config extends Settings {
    oddsApi: { apiKey: string };
    footballData: { token: string };
    telegram: { botToken: string; ownerChatId: number };
    anthropic: { apiKey: string | undefined };
    database: { kind: "postgres"; url: string } | { kind: "pglite"; dir: string };
    /** External dead man's switch (e.g. healthchecks.io), pinged while the worker runs. */
    healthcheckPingUrl: string | undefined;
    heartbeatPath: string;
    logLevel: LogLevel;
}

export class ConfigError extends Error {
    override name = "ConfigError";
}

/** Validates raw env vars and settings into a typed config. Throws ConfigError listing every problem. */
export function parseConfig(env: Record<string, string | undefined>, settings: unknown = {}): Config {
    const envResult = envSchema.safeParse(env);
    const settingsResult = settingsSchema.safeParse(settings);
    if (!envResult.success || !settingsResult.success) {
        const problems = [...formatIssues(envResult.error, "env"), ...formatIssues(settingsResult.error, "settings")];
        throw new ConfigError(`Invalid configuration:\n${problems.join("\n")}`);
    }

    const e = envResult.data;
    return {
        ...settingsResult.data,
        oddsApi: { apiKey: e.ODDS_API_KEY },
        footballData: { token: e.FOOTBALL_DATA_TOKEN },
        telegram: {
            botToken: e.TELEGRAM_BOT_TOKEN,
            ownerChatId: e.TELEGRAM_OWNER_CHAT_ID,
        },
        anthropic: { apiKey: e.ANTHROPIC_API_KEY },
        database: e.DATABASE_URL ? { kind: "postgres", url: e.DATABASE_URL } : { kind: "pglite", dir: e.PGLITE_DIR },
        healthcheckPingUrl: e.HEALTHCHECK_PING_URL,
        heartbeatPath: e.HEARTBEAT_PATH,
        logLevel: e.LOG_LEVEL,
    };
}

function formatIssues(error: z.ZodError | undefined, source: string): string[] {
    return (error?.issues ?? []).map((issue) => `  - ${source} ${issue.path.join(".") || "(root)"}: ${issue.message}`);
}

/** Reads config from process.env and the optional JSON settings file at CONFIG_PATH. */
export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
    const path = env.CONFIG_PATH;
    let settings: unknown = {};
    if (path) {
        try {
            settings = JSON.parse(readFileSync(path, "utf8"));
        } catch (error) {
            throw new ConfigError(`Cannot read settings file ${path}: ${(error as Error).message}`);
        }
    }
    return parseConfig(env, settings);
}
