import { bookName, pickText } from "@closing-line/core";
import type { BetWithFixture, Player } from "@closing-line/db";
import { odds, percent, shortDate, signedKroner, kroner } from "../lib/format.ts";
import { groupBets } from "../lib/groups.ts";
import { playerColour } from "./players.ts";

const STATUS_STYLE: Record<BetWithFixture["status"], string> = {
    open: "text-zinc-500",
    won: "text-emerald-600 dark:text-emerald-400",
    lost: "text-rose-600 dark:text-rose-400",
    void: "text-zinc-400",
    cashed_out: "text-amber-600 dark:text-amber-400",
};

function pick(bet: BetWithFixture): string {
    if (bet.market === "h2h" && bet.fixture) {
        // The scanner's 1X2 bets: the team itself, as before.
        if (bet.selection === "home") return bet.fixture.homeTeam;
        if (bet.selection === "away") return bet.fixture.awayTeam;
        return "Draw";
    }
    return pickText(bet);
}

/** Why a bettor took the bet, as tagged in Telegram. */
const REASONS: Record<NonNullable<BetWithFixture["tag"]>, string> = {
    lineup: "⚡ Lineup",
    skewed_price: "📈 Skewed price",
    game_read: "🧠 Game read",
    slow_live_price: "⏱ Slow live",
    value_tip: "🔎 Value tip",
};

/** A bettor's tag; the automated players always bet for the same reason, so theirs follows from their kind. */
export function reason(bet: BetWithFixture, player: Pick<Player, "kind"> | undefined): string {
    if (player?.kind === "scanner") {
        return bet.edgeAtBet === null ? "" : `📊 ${percent(bet.edgeAtBet)} vs Pinnacle`;
    }
    if (player?.kind === "benchmark") return "⭐ Pinnacle favourite";
    if (!bet.selfReported) return "";
    return bet.tag ? REASONS[bet.tag] : "";
}

function match(bet: BetWithFixture): string {
    return bet.fixture ? `${bet.fixture.homeTeam} v ${bet.fixture.awayTeam}` : (bet.eventName ?? "");
}

export function BetsTable({
    bets,
    players,
    now = new Date(),
}: {
    bets: BetWithFixture[];
    players: Map<string, Player>;
    now?: Date;
}) {
    return (
        <div className="overflow-x-auto rounded-xl border border-zinc-200 dark:border-zinc-800">
            <table className="w-full text-sm" data-testid="bets-table">
                <thead className="bg-zinc-50 text-left text-xs text-zinc-500 dark:bg-zinc-900">
                    <tr>
                        <th className="px-3 py-2 font-medium">Match time</th>
                        <th className="px-3 py-2 font-medium">Player</th>
                        <th className="px-3 py-2 font-medium">Match</th>
                        <th className="px-3 py-2 font-medium">Pick</th>
                        <th className="px-3 py-2 font-medium">Bookmaker</th>
                        <th className="px-3 py-2 font-medium">Reason</th>
                        <th className="px-3 py-2 text-right font-medium">Odds</th>
                        <th className="px-3 py-2 text-right font-medium">Stake</th>
                        <th
                            className="px-3 py-2 text-right font-medium"
                            title="Closing line value: the odds taken against Pinnacle's fair price just before kickoff"
                        >
                            CLV
                        </th>
                        <th className="px-3 py-2 text-right font-medium">Result</th>
                    </tr>
                </thead>
                {groupBets(bets, now).map((group) => (
                    <tbody
                        key={`${group.label}-${group.bets[0]?.id ?? ""}`}
                        className="divide-y divide-zinc-100 dark:divide-zinc-900"
                    >
                        <tr className="bg-zinc-50/60 dark:bg-zinc-900/60">
                            <th
                                colSpan={10}
                                scope="colgroup"
                                className="px-3 pt-4 pb-1 text-left text-xs font-semibold text-zinc-600 dark:text-zinc-300"
                            >
                                {group.label}
                            </th>
                        </tr>
                        {group.bets.map((bet) => {
                            const player = players.get(bet.playerId);
                            return (
                                <tr key={bet.id} data-testid="bet-row">
                                    <td className="px-3 py-2 whitespace-nowrap text-zinc-500">
                                        {bet.fixture ? (
                                            shortDate(bet.fixture.kickoff)
                                        ) : (
                                            // A match we do not track has no kickoff, only when the bet was logged.
                                            <span title="Match time unknown: when the bet was logged">
                                                logged {shortDate(bet.receivedAt ?? bet.createdAt)}
                                            </span>
                                        )}
                                    </td>
                                    <td className="px-3 py-2 whitespace-nowrap">
                                        <span
                                            className="mr-2 inline-block size-2 rounded-full"
                                            style={{ background: player ? playerColour(player) : undefined }}
                                        />
                                        {player?.name ?? bet.playerId}
                                    </td>
                                    <td className="px-3 py-2 whitespace-nowrap">{match(bet)}</td>
                                    <td className="px-3 py-2 whitespace-nowrap">{pick(bet)}</td>
                                    <td className="px-3 py-2 whitespace-nowrap text-zinc-500">
                                        {bookName(bet.bookmaker)}
                                    </td>
                                    <td className="px-3 py-2 whitespace-nowrap text-zinc-500">{reason(bet, player)}</td>
                                    <td className="px-3 py-2 text-right tabular-nums">{odds(bet.lockedOdds)}</td>
                                    <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">
                                        {kroner(bet.stakeOre)}
                                    </td>
                                    <td className="px-3 py-2 text-right tabular-nums">
                                        {percent(bet.clv ?? undefined)}
                                    </td>
                                    <td
                                        className={`px-3 py-2 text-right tabular-nums whitespace-nowrap ${STATUS_STYLE[bet.status]}`}
                                    >
                                        {bet.status === "open" ? "open" : signedKroner(bet.profitOre ?? 0)}
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                ))}
            </table>
        </div>
    );
}
