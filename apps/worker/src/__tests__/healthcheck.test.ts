import { mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isHealthy } from "../healthcheck.ts";

describe("isHealthy", () => {
    it("needs a heartbeat from the last three minutes", () => {
        const path = join(mkdtempSync(join(tmpdir(), "heartbeat-")), "heartbeat");
        expect(isHealthy(path)).toBe(false);
        writeFileSync(path, "now");
        expect(isHealthy(path)).toBe(true);
        utimesSync(path, new Date(Date.now() - 4 * 60_000), new Date(Date.now() - 4 * 60_000));
        expect(isHealthy(path)).toBe(false);
    });
});
