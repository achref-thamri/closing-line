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

    it("does not retry permanent errors", async () => {
        const fn = vi.fn(() => Promise.reject(new PermanentError("bad request")));
        await expect(retry(fn, { sleep: () => Promise.resolve() })).rejects.toThrow("bad request");
        expect(fn).toHaveBeenCalledOnce();
    });

    it("waits for real by default", async () => {
        vi.useFakeTimers();
        const fn = vi
            .fn<() => Promise<string>>()
            .mockRejectedValueOnce(new TransientError("blip"))
            .mockResolvedValue("ok");
        const pending = retry(fn, { baseDelayMs: 100, random: () => 1 });
        await vi.advanceTimersByTimeAsync(100);
        await expect(pending).resolves.toBe("ok");
        vi.useRealTimers();
    });
});
