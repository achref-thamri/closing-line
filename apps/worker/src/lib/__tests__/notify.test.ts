import { mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { isHealthy } from "../../healthcheck.ts";
import type { Fetch } from "../http.ts";
import { createLogger, silentLogger, type Logger } from "../logger.ts";
import { createPinger } from "../ping.ts";
import { createTextSender } from "../telegram.ts";

function spyLogger(): { logger: Logger; warn: ReturnType<typeof vi.fn> } {
    const warn = vi.fn();
    return { logger: { ...silentLogger, warn }, warn };
}

describe("createTextSender", () => {
    it("sends plain text without link previews", async () => {
        const sendMessage = vi.fn().mockResolvedValue({});
        await createTextSender({ api: { sendMessage }, logger: silentLogger })(42, "hello");
        expect(sendMessage).toHaveBeenCalledWith(42, "hello", { link_preview_options: { is_disabled: true } });
    });

    it("logs a failed message instead of throwing", async () => {
        const { logger, warn } = spyLogger();
        const sendMessage = vi.fn().mockRejectedValue(new Error("Call to 'sendMessage' failed! (403: Forbidden)"));
        await createTextSender({ api: { sendMessage }, logger })(42, "hi");
        expect(warn).toHaveBeenCalledWith(
            { chatId: 42, error: "Call to 'sendMessage' failed! (403: Forbidden)" },
            "telegram message failed",
        );
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
