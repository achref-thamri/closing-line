import { createRepositories, openDatabase, type DatabaseHandle, type Repositories } from "@betting/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { OutOfCreditsError, type CreditBalance, type Priced } from "../../ports/odds.ts";
import { CreditGuard } from "../creditGuard.ts";

let handle: DatabaseHandle;
let repos: Repositories;
let now: Date;
let warnings: string[];
let freeBalance: ReturnType<typeof vi.fn<() => Promise<CreditBalance>>>;

beforeAll(async () => {
    handle = await openDatabase({ kind: "pglite" });
    repos = createRepositories(handle.db);
});

afterAll(async () => {
    await handle.close();
});

beforeEach(async () => {
    await handle.db.execute("truncate api_usage restart identity");
    now = new Date("2026-11-10T09:00:00Z");
    warnings = [];
    freeBalance = vi.fn(() => Promise.resolve(balance(100, 400, 0)));
});

function balance(used: number, remaining: number, lastCost = 1): CreditBalance {
    return { used, remaining, lastCost, takenAt: now };
}

function guard() {
    return new CreditGuard({
        usage: repos.apiUsage,
        source: { balance: freeBalance },
        now: () => now,
        reserve: 50,
        warnAt: [0.7, 0.9],
        warn: (message) => {
            warnings.push(message);
            return Promise.resolve();
        },
    });
}

/** A paid call that reports `after` as the new balance. */
function call(after: CreditBalance) {
    return vi.fn(() => Promise.resolve<Priced<string>>({ data: "odds", balance: after }));
}

async function seed(used: number, remaining: number, takenAt: Date) {
    await repos.apiUsage.record({ provider: "odds-api", used, remaining, lastCost: 1, takenAt });
}

describe("CreditGuard", () => {
    it("reads the balance from a free call when it has none, then spends", async () => {
        const paid = call(balance(101, 399));
        expect(await guard().spend(1, "scan", paid)).toEqual({ ok: true, data: "odds" });
        expect(freeBalance).toHaveBeenCalledOnce();
        expect(await repos.apiUsage.latest("odds-api")).toMatchObject({ used: 101, remaining: 399 });
    });

    it("refreshes a balance from before the monthly reset", async () => {
        await seed(480, 20, new Date("2026-10-31T20:00:00Z"));
        const paid = call(balance(101, 399));
        expect((await guard().spend(1, "scan", paid)).ok).toBe(true);
        expect(freeBalance).toHaveBeenCalledOnce();
    });

    it("stops routine polls at the daily allowance", async () => {
        // 21 days left with 400 at midnight: (400 - 50) / 21 = 16 credits today.
        await seed(100, 400, new Date("2026-11-09T22:00:00Z"));
        await seed(116, 384, new Date("2026-11-10T08:00:00Z"));
        const paid = call(balance(117, 383));

        expect(await guard().spend(1, "scan", paid)).toEqual({
            ok: false,
            reason: "daily allowance of 16 credits used (16 spent today)",
        });
        expect(paid).not.toHaveBeenCalled();
        expect((await guard().spend(1, "closing", paid)).ok).toBe(true);
    });

    it("counts the first day of the month from the full quota", async () => {
        now = new Date("2026-12-01T12:00:00Z");
        await seed(0, 500, new Date("2026-12-01T00:30:00Z"));
        await seed(14, 486, new Date("2026-12-01T11:00:00Z"));
        // (500 - 50) / 31 = 14 credits on 1 December, all spent.
        expect((await guard().spend(1, "scan", call(balance(15, 485)))).ok).toBe(false);
    });

    it("keeps the reserve for people", async () => {
        await seed(450, 50, now);
        const paid = call(balance(451, 49));
        expect((await guard().spend(1, "closing", paid)).ok).toBe(false);
        expect(await guard().spend(1, "bet", paid)).toEqual({ ok: true, data: "odds" });
    });

    it("warns once as usage passes each level", async () => {
        await seed(349, 151, now);
        await guard().spend(1, "bet", call(balance(350, 150)));
        await guard().spend(1, "bet", call(balance(351, 149)));
        expect(warnings).toEqual([
            "⚠️ Odds API credits: 70% used (350 of 500). Routine checks slow down to make the rest last the month.",
        ]);
    });

    it("warns about levels already passed when it first sees the balance", async () => {
        freeBalance.mockResolvedValueOnce(balance(460, 40, 0));
        await guard().spend(1, "bet", call(balance(461, 39)));
        expect(warnings).toHaveLength(2);
    });

    it("records a used-up quota and pauses instead of failing", async () => {
        await seed(100, 400, now);
        const exhausted = vi.fn(() =>
            Promise.reject(new OutOfCreditsError("Odds API: the monthly credits are used up")),
        );
        expect(await guard().spend(1, "bet", exhausted)).toEqual({
            ok: false,
            reason: "Odds API: the monthly credits are used up",
        });
        expect(await repos.apiUsage.latest("odds-api")).toMatchObject({ used: 500, remaining: 0 });
        expect(warnings.at(-1)).toBe("🛑 Odds API credits are used up. Odds checks pause until the 1st of next month.");
        expect((await guard().spend(1, "bet", call(balance(500, 0)))).ok).toBe(false);
    });

    it("passes other errors on", async () => {
        await seed(100, 400, now);
        const failing = vi.fn(() => Promise.reject(new Error("network down")));
        await expect(guard().spend(1, "bet", failing)).rejects.toThrow("network down");
    });
});
