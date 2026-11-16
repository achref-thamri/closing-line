import { defaultSettings } from "@closing-line/config";
import type { ScannerRules } from "@closing-line/core";

/**
 * The scanner's rules as the worker runs them. The dashboard doesn't read the worker's settings file, so an override
 * there isn't seen here; the server runs on the defaults.
 */
export const SCANNER_RULES: ScannerRules = defaultSettings().scanner;
