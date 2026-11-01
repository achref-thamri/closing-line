import {
    crossedUsageLevels,
    daysLeftInMonth,
    decideCredits,
    type CreditPriority,
    type CreditState,
} from "@betting/core";
import type { ApiUsage, Repositories } from "@betting/db";
import { OutOfCreditsError, type CreditBalance, type OddsSource, type Priced } from "../ports/odds.ts";

const PROVIDER = "odds-api";

export interface CreditGuardDeps {
    usage: Pick<Repositories["apiUsage"], "latest" | "latestBefore" | "record">;
    source: Pick<OddsSource, "balance">;
    now: () => Date;
    /** Credits automated calls never touch. */
    reserve: number;
    /** Usage shares that trigger a warning, e.g. 0.7 and 0.9. */
    warnAt: readonly number[];
    warn: (message: string) => Promise<void>;
}

export type Spent<T> = { ok: true; data: T } | { ok: false; reason: string };

/**
 * Gatekeeper for paid Odds API calls. It decides from the last recorded balance whether a call may run, records
 * the balance every response reports, and warns as usage passes each level. The quota resets on the first of
 * each month (UTC).
 */
export class CreditGuard {
    private readonly deps: CreditGuardDeps;

    constructor(deps: CreditGuardDeps) {
        this.deps = deps;
    }

    /** Runs `call` only if `priority` may spend `cost` credits now; never throws for a used-up quota. */
    async spend<T>(cost: number, priority: CreditPriority, call: () => Promise<Priced<T>>): Promise<Spent<T>> {
        const state = await this.state();
        const decision = decideCredits(state, cost, priority, this.deps.reserve);
        if (!decision.allowed) return { ok: false, reason: decision.reason };

        try {
            const { data, balance } = await call();
            await this.record(balance);
            return { ok: true, data };
        } catch (error) {
            if (!(error instanceof OutOfCreditsError)) throw error;
            const latest = await this.deps.usage.latest(PROVIDER);
            const total = latest ? latest.used + latest.remaining : 0;
            await this.record({ used: total, remaining: 0, lastCost: 0, takenAt: this.deps.now() });
            await this.deps.warn("🛑 Odds API credits are used up. Odds checks pause until the 1st of next month.");
            return { ok: false, reason: error.message };
        }
    }

    /** Stores a balance (free calls report one too) and warns about usage levels passed since the last one. */
    async record(balance: CreditBalance): Promise<void> {
        const previous = await this.currentMonthLatest();
        await this.deps.usage.record({ provider: PROVIDER, ...balance });
        const before = previous ?? { used: 0, remaining: balance.used + balance.remaining };
        for (const level of crossedUsageLevels(before, balance, this.deps.warnAt)) {
            const total = balance.used + balance.remaining;
            await this.deps.warn(
                `⚠️ Odds API credits: ${Math.round(level * 100)}% used (${balance.used} of ${total}). ` +
                    "Routine checks slow down to make the rest last the month.",
            );
        }
    }

    private async state(): Promise<CreditState> {
        const now = this.deps.now();
        const latest = (await this.currentMonthLatest()) ?? (await this.refresh());
        const dayStart = startOfUtcDay(now);
        const before = await this.deps.usage.latestBefore(PROVIDER, dayStart);

        let remainingAtDayStart = latest.remaining;
        if (before && before.takenAt >= startOfUtcMonth(now)) remainingAtDayStart = before.remaining;
        else if (dayStart.getTime() === startOfUtcMonth(now).getTime())
            remainingAtDayStart = latest.used + latest.remaining;

        return { remaining: latest.remaining, remainingAtDayStart, daysLeft: daysLeftInMonth(now) };
    }

    /** The latest balance if it was taken this month; older ones predate the reset. */
    private async currentMonthLatest(): Promise<ApiUsage | undefined> {
        const latest = await this.deps.usage.latest(PROVIDER);
        return latest && latest.takenAt >= startOfUtcMonth(this.deps.now()) ? latest : undefined;
    }

    private async refresh(): Promise<CreditBalance> {
        const balance = await this.deps.source.balance();
        await this.record(balance);
        return balance;
    }
}

function startOfUtcDay(date: Date): Date {
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function startOfUtcMonth(date: Date): Date {
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}
