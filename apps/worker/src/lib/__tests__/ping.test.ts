import { describe, expect, it, vi, type Mock } from "vitest";
import type { Fetch } from "../http.ts";
import { silentLogger, type Logger } from "../logger.ts";
import { createPinger } from "../ping.ts";

function spyLogger(): { logger: Logger; warn: Mock } {
    const warn = vi.fn();
    return { logger: { ...silentLogger, warn }, warn };
}

describe("createPinger", () => {
    it("pings at most once per interval and never throws", async () => {
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
