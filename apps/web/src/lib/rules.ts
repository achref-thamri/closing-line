import { defaultSettings } from "@closing-line/config";
import type { ScannerRules } from "@closing-line/core";

/**
 * The scanner's rules as the worker runs them. The dashboard doesn't read the worker's settings file, so an override
 * there isn't seen here; the server runs on the defaults.
 */
const settings = defaultSettings();
export const SCANNER_RULES: ScannerRules = {
    ...settings.scanner,
    closingWindowMinutes: settings.closingWindowMinutes,
    bookmakers: settings.bookmakers,
};
/** The time zone dates and times are shown in. */
export const TIME_ZONE = settings.timezone;
