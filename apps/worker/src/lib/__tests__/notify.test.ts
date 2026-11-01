import { mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { isHealthy } from "../../healthcheck.ts";
import type { Fetch } from "../http.ts";
import { createLogger, silentLogger, type Logger } from "../logger.ts";
import { createPinger } from "../ping.ts";
import { createTelegramNotifier } from "../telegram.ts";

function spyLogger(): { logger: Logger; warn: ReturnType<typeof vi.fn> } {
    const warn = vi.fn();
    return { logger: { ...silentLogger, warn }, warn };
}

describe("createTelegramNotifier", () => {
    it("posts the text to the chat", async () => {
        const fetch = vi.fn<Fetch>().mockResolvedValue(new Response("{}"));
        await createTelegramNotifier({ botToken: "123:abc", chatId: 42, logger: silentLogger, fetch })("hello");
        const [url, init] = fetch.mock.calls[0] ?? [];
        expect(url).toBe("https://api.telegram.org/bot123:abc/sendMessage");
        expect(JSON.parse(init?.body as string)).toMatchObject({ chat_id: 42, text: "hello" });
    });

    it("logs failures without throwing or leaking the token", async () => {
        const { logger, warn } = spyLogger();
        const refused = vi.fn<Fetch>().mockResolvedValue(new Response("{}", { status: 403 }));
        await createTelegramNotifier({ botToken: "123:abc", chatId: 42, logger, fetch: refused })("hi");
        const broken = vi.fn<Fetch>().mockRejectedValue(new TypeError("fetch failed"));
        await createTelegramNotifier({ botToken: "123:abc", chatId: 42, logger, fetch: broken })("hi");
        expect(warn.mock.calls).toEqual([
            [{ status: 403 }, "telegram message refused"],
            [{ error: "TypeError" }, "telegram message failed"],
        ]);
    });
});

describe("createPinger", () => {
    it("pings at most every few minutes and never throws", async () => {
        const { logger, warn } = spyLogger();
        const fetch = vi
            .fn<Fetch>()
            .mockResolvedValueOnce(new Response("", { status: 500 }))
            .mockRejectedValueOnce(new Error("timeout"));
        const ping = createPinger({ url: "https://hc-ping.com/x", logger, fetch, everyMs: 60_000 });
        ping(new Date(0));
        await vi.waitFor(() => {
            expect(warn).toHaveBeenCalledWith({ status: 500 }, "healthcheck ping refused");
        });
        ping(new Date(30_000));
        expect(fetch).toHaveBeenCalledOnce();
        ping(new Date(60_000));
        await vi.waitFor(() => {
            expect(warn).toHaveBeenCalledWith({ error: "Error" }, "healthcheck ping failed");
        });
    });
});

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

describe("createLogger", () => {
    it("creates a pino logger at the given level", () => {
        expect(createLogger("warn")).toHaveProperty("level", "warn");
    });
});
