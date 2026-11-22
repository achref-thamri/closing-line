import { mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createBackupCheck } from "../backupCheck.ts";
import type { Fetch } from "../http.ts";
import { silentLogger } from "../logger.ts";

const URL = "https://hc-ping.com/backup";
const now = new Date("2026-11-22T12:00:00Z");
const hoursAgo = (hours: number) => new Date(now.getTime() - hours * 3_600_000);

let dir: string;
beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "backups-"));
});
afterEach(() => {
    rmSync(dir, { recursive: true });
});

function dump(name: string, at: Date): void {
    const path = join(dir, name);
    writeFileSync(path, "x");
    utimesSync(path, at, at);
}

function check() {
    const fetch = vi.fn<Fetch>().mockResolvedValue(new Response(""));
    return { fetch, run: createBackupCheck({ url: URL, dir, logger: silentLogger, fetch }) };
}

describe("createBackupCheck", () => {
    it("pings while the newest dump is under 26 hours old", () => {
        dump("closing-line-2026-11-20.sql.gz", hoursAgo(57));
        dump("closing-line-2026-11-22.sql.gz", hoursAgo(9));
        const { fetch, run } = check();
        run(now);
        expect(fetch.mock.calls[0]?.[0]).toBe(URL);
    });

    it("reports a failure when the newest dump is older, or there is none", () => {
        dump("closing-line-2026-11-21.sql.gz", hoursAgo(27));
        const stale = check();
        stale.run(now);
        expect(stale.fetch.mock.calls[0]?.[0]).toBe(`${URL}/fail`);

        rmSync(join(dir, "closing-line-2026-11-21.sql.gz"));
        dump("unrelated.txt", hoursAgo(1));
        const none = check();
        none.run(now);
        expect(none.fetch.mock.calls[0]?.[0]).toBe(`${URL}/fail`);
    });

    it("checks at most once an hour", () => {
        dump("closing-line-2026-11-22.sql.gz", hoursAgo(9));
        const { fetch, run } = check();
        run(now);
        run(new Date(now.getTime() + 59 * 60_000));
        expect(fetch).toHaveBeenCalledOnce();
        run(new Date(now.getTime() + 60 * 60_000));
        expect(fetch).toHaveBeenCalledTimes(2);
    });
});
