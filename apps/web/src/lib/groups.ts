import type { BetWithFixture } from "@closing-line/db";

export interface BetGroup {
    label: string;
    bets: BetWithFixture[];
}

const DAY_MS = 86_400_000;

/** When an open bet's match starts; a match we do not track only has the time the bet was logged. */
function startOf(bet: BetWithFixture): Date {
    return bet.fixture?.kickoff ?? bet.receivedAt ?? bet.createdAt;
}

/**
 * Splits a page of bets (open ones already in kickoff order, then settled ones) into headed groups: one per
 * kickoff day for open bets, so what plays today stands out, and one for everything settled. Open bets on a day
 * already past are still waiting for their result.
 */
export function groupBets(bets: readonly BetWithFixture[], now: Date, timeZone = "Europe/Copenhagen"): BetGroup[] {
    const dayKey = (date: Date) => date.toLocaleDateString("en-CA", { timeZone });
    const today = dayKey(now);
    const tomorrow = dayKey(new Date(now.getTime() + DAY_MS));
    const label = (date: Date) => {
        const key = dayKey(date);
        if (key < today) return "Waiting for a result";
        const day = date.toLocaleDateString("en-GB", { timeZone, weekday: "short", day: "numeric", month: "short" });
        if (key === today) return `Today · ${day}`;
        if (key === tomorrow) return `Tomorrow · ${day}`;
        return day;
    };

    const groups: BetGroup[] = [];
    for (const bet of bets) {
        const name = bet.status === "open" ? label(startOf(bet)) : "Settled";
        const last = groups.at(-1);
        if (last?.label === name) last.bets.push(bet);
        else groups.push({ label: name, bets: [bet] });
    }
    return groups;
}
