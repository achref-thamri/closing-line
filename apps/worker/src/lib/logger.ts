import { pino } from "pino";

/** The logging calls the worker uses; pino's logger fits, and tests pass a silent one. */
export interface Logger {
    info(obj: object, message?: string): void;
    warn(obj: object, message?: string): void;
    error(obj: object, message?: string): void;
}

export function createLogger(level: string): Logger {
    return pino({ level, base: { app: "closing-line" } });
}

export const silentLogger: Logger = { info: () => undefined, warn: () => undefined, error: () => undefined };
