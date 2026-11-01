/**
 * Why a paid API call is made, highest priority last:
 * - `scan`: routine polls, the first to be dropped;
 * - `closing`: closing prices for matches with open bets;
 * - `bet`: a human placing a bet, which may use the reserve too.
 */
export type CreditPriority = "scan" | "closing" | "bet";

export interface CreditState {
    remaining: number;
    /** Remaining credits when the current day began, for the daily allowance. */
    remainingAtDayStart: number;
    /** Days until the quota resets, counting today; at least 1. */
    daysLeft: number;
}

export type CreditDecision = { allowed: true } | { allowed: false; reason: string };

/** Decides whether a call costing `cost` credits may go ahead, keeping `reserve` credits for people. */
export function decideCredits(
    state: CreditState,
    cost: number,
    priority: CreditPriority,
    reserve: number,
): CreditDecision {
    const after = state.remaining - cost;
    if (priority === "bet") {
        return after >= 0 ? { allowed: true } : { allowed: false, reason: "no credits left this month" };
    }
    if (after < reserve) return { allowed: false, reason: `would dip into the ${reserve}-credit reserve` };
    if (priority === "closing") return { allowed: true };

    const allowance = dailyAllowance(state, reserve);
    const spentToday = Math.max(0, state.remainingAtDayStart - state.remaining);
    return spentToday + cost <= allowance
        ? { allowed: true }
        : { allowed: false, reason: `daily allowance of ${allowance} credits used (${spentToday} spent today)` };
}

/** Credits that routine polls may spend today, so the month's credits last until the reset. */
export function dailyAllowance(state: CreditState, reserve: number): number {
    return Math.max(0, Math.floor((state.remainingAtDayStart - reserve) / Math.max(1, state.daysLeft)));
}

/** Usage shares in `levels` passed between two readings, for one-time warnings. */
export function crossedUsageLevels(
    before: { used: number; remaining: number },
    after: { used: number; remaining: number },
    levels: readonly number[],
): number[] {
    const share = ({ used, remaining }: { used: number; remaining: number }) =>
        used + remaining === 0 ? 0 : used / (used + remaining);
    const from = share(before);
    const to = share(after);
    return levels.filter((level) => from < level && to >= level);
}

/** Days until the first of next month (UTC, when the quota resets), counting `now`'s day. */
export function daysLeftInMonth(now: Date): number {
    const nextMonth = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1);
    const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    return Math.round((nextMonth - today) / 86_400_000);
}
