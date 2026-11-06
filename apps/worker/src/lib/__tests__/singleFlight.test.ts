import { describe, expect, it, vi } from "vitest";
import { singleFlight } from "../singleFlight.ts";

describe("singleFlight", () => {
    it("shares one run between overlapping calls and starts a new one after it settles", async () => {
        let finish: () => void = () => undefined;
        const task = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)));
        const run = singleFlight(task);

        const first = run();
        const second = run();
        expect(task).toHaveBeenCalledTimes(1);
        finish();
        await Promise.all([first, second]);

        void run();
        expect(task).toHaveBeenCalledTimes(2);
        finish();
    });

    it("lets the next call retry after a failed run", async () => {
        const task = vi.fn().mockRejectedValueOnce(new Error("down")).mockResolvedValueOnce(undefined);
        const run = singleFlight(task);
        await expect(run()).rejects.toThrow("down");
        await expect(run()).resolves.toBeUndefined();
        expect(task).toHaveBeenCalledTimes(2);
    });
});
