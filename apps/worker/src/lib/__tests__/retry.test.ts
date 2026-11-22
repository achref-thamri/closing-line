import { describe, expect, it, vi } from "vitest";
import { PermanentError, TransientError } from "../errors.ts";
import { retry } from "../retry.ts";

describe("retry", () => {
    it("backs off exponentially with jitter, honouring Retry-After", async () => {
        const delays: number[] = [];
        const onRetry = vi.fn();
        const fn = vi
            .fn<(attempt: number) => Promise<string>>()
            .mockRejectedValueOnce(new TransientError("first"))
            .mockRejectedValueOnce(new TransientError("second", 5_000))
            .mockResolvedValue("done");

        const result = await retry(fn, {
            attempts: 3,
            baseDelayMs: 1_000,
            random: () => 0.5,
            sleep: (ms) => {
                delays.push(ms);
                return Promise.resolve();
            },
            onRetry,
        });

        expect(result).toBe("done");
        expect(delays).toEqual([500, 5_000]);
        expect(onRetry).toHaveBeenCalledTimes(2);
        expect(fn.mock.calls.map(([attempt]) => attempt)).toEqual([1, 2, 3]);
    });

    it("gives up at once when the server asks for a longer wait than it would ever back off", async () => {
        const sleep = vi.fn(() => Promise.resolve());
        const fn = vi.fn<() => Promise<string>>().mockRejectedValue(new TransientError("quota", 86_400_000));
        await expect(retry(fn, { attempts: 3, maxDelayMs: 30_000, sleep })).rejects.toThrow("quota");
        expect(fn).toHaveBeenCalledOnce();
        expect(sleep).not.toHaveBeenCalled();
    });

    it("does not retry permanent errors", async () => {
        const fn = vi.fn(() => Promise.reject(new PermanentError("bad request")));
        await expect(retry(fn, { sleep: () => Promise.resolve() })).rejects.toThrow("bad request");
        expect(fn).toHaveBeenCalledOnce();
    });

    it("waits with setTimeout when no sleep is passed in", async () => {
        vi.useFakeTimers();
        try {
            const fn = vi
                .fn<() => Promise<string>>()
                .mockRejectedValueOnce(new TransientError("blip"))
                .mockResolvedValue("ok");
            const pending = retry(fn, { baseDelayMs: 100, random: () => 1 });
            await vi.advanceTimersByTimeAsync(100);
            await expect(pending).resolves.toBe("ok");
        } finally {
            // Even when an assertion fails, so later tests get real timers.
            vi.useRealTimers();
        }
    });
});
