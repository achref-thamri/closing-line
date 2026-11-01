import type { Config } from "@betting/config";
import { statsFromTotals, totalsOf } from "@betting/core";
import type { Repositories } from "@betting/db";

const WEEK_MS = 7 * 86_400_000;
/** Settled bets a player needs before its results mean much (the spec's go-live rule). */
const BETS_TO_JUDGE = 300;

export interface WeeklyReportDeps {
    repos: Pick<Repositories, "players" | "bets" | "apiUsage">;
    config: Pick<Config, "timezone">;
    now: () => Date;
}

/** One message with every player's week and all-time results, and the API credit balance. */
export async function weeklyReport(deps: WeeklyReportDeps): Promise<string> {
    const now = deps.now();
    const weekStart = new Date(now.getTime() - WEEK_MS);
    const lines = [
        `📊 Weekly report, ${dateText(weekStart, deps.config.timezone)} – ${dateText(now, deps.config.timezone)}`,
    ];
    let mostSettled = 0;
    const allTotals = await deps.repos.bets.totals();
    const weekTotals = await deps.repos.bets.totals({ settledSince: weekStart });
    const none = totalsOf([]);

    for (const player of await deps.repos.players.list()) {
        const week = statsFromTotals(weekTotals.get(player.id) ?? none);
        const all = statsFromTotals(allTotals.get(player.id) ?? none);
        mostSettled = Math.max(mostSettled, all.settled);
        lines.push(
            "",
            player.name,
            `This week: ${week.settled} settled, ${money(week.profitOre)}`,
            `All time: ${all.settled} settled (${all.won} won), ROI ${percent(all.roi)}, CLV ${percent(all.averageClv)}, ` +
                `bankroll ${kroner(player.startingBankrollOre + all.profitOre)}, ${all.open} open`,
        );
    }

    const usage = await deps.repos.apiUsage.latest("odds-api");
    if (usage) lines.push("", `Odds API: ${usage.used} credits used this month, ${usage.remaining} left.`);
    if (mostSettled < BETS_TO_JUDGE) {
        lines.push(`Too early to judge: ${mostSettled} of ${BETS_TO_JUDGE} settled bets so far.`);
    }
    return lines.join("\n");
}

function money(ore: number): string {
    return `${ore >= 0 ? "+" : "−"}${kroner(Math.abs(ore))}`;
}

function kroner(ore: number): string {
    return `${Math.round(ore / 100).toLocaleString("en-GB")} kr`;
}

function percent(value: number | undefined): string {
    if (value === undefined) return "–";
    return `${value >= 0 ? "+" : "−"}${Math.abs(value * 100).toFixed(1)}%`;
}

function dateText(date: Date, timeZone: string): string {
    return date.toLocaleDateString("en-GB", { timeZone, day: "numeric", month: "short" });
}
