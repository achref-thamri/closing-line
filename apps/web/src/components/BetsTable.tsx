import { bookName, pickText } from "@closing-line/core";
import type { BetWithFixture, Player } from "@closing-line/db";
import { odds, percent, shortDate, signedKroner, kroner } from "../lib/format.ts";
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
};

function reason(bet: BetWithFixture): string {
    if (!bet.selfReported) return "";
    return bet.tag ? REASONS[bet.tag] : "";
}

function match(bet: BetWithFixture): string {
    return bet.fixture ? `${bet.fixture.homeTeam} v ${bet.fixture.awayTeam}` : (bet.eventName ?? "");
}

export function BetsTable({ bets, players }: { bets: BetWithFixture[]; players: Map<string, Player> }) {
    return (
        <div className="overflow-x-auto rounded-xl border border-zinc-200 dark:border-zinc-800">
            <table className="w-full text-sm" data-testid="bets-table">
                <thead className="bg-zinc-50 text-left text-xs text-zinc-500 dark:bg-zinc-900">
                    <tr>
                        <th className="px-3 py-2 font-medium">Kickoff</th>
                        <th className="px-3 py-2 font-medium">Player</th>
                        <th className="px-3 py-2 font-medium">Match</th>
                        <th className="px-3 py-2 font-medium">Pick</th>
                        <th className="px-3 py-2 font-medium">Bookmaker</th>
                        <th className="px-3 py-2 font-medium">Reason</th>
                        <th className="px-3 py-2 text-right font-medium">Odds</th>
                        <th className="px-3 py-2 text-right font-medium">Stake</th>
                        <th
                            className="px-3 py-2 text-right font-medium"
                            title="Closing line value; for player props, the price move read from a cash-out"
                        >
                            CLV / move
                        </th>
                        <th className="px-3 py-2 text-right font-medium">Result</th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 dark:divide-zinc-900">
                    {bets.map((bet) => {
                        const player = players.get(bet.playerId);
                        return (
                            <tr key={bet.id}>
                                <td className="px-3 py-2 whitespace-nowrap text-zinc-500">
                                    {shortDate(bet.fixture?.kickoff ?? bet.placedAt ?? bet.createdAt)}
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
                                <td className="px-3 py-2 whitespace-nowrap text-zinc-500">{bookName(bet.bookmaker)}</td>
                                <td className="px-3 py-2 whitespace-nowrap text-zinc-500">{reason(bet)}</td>
                                <td className="px-3 py-2 text-right tabular-nums">{odds(bet.lockedOdds)}</td>
                                <td className="px-3 py-2 text-right tabular-nums">{kroner(bet.stakeOre)}</td>
                                <td className="px-3 py-2 text-right tabular-nums">{percent(bet.clv ?? undefined)}</td>
                                <td
                                    className={`px-3 py-2 text-right tabular-nums whitespace-nowrap ${STATUS_STYLE[bet.status]}`}
                                >
                                    {bet.status === "open" ? "open" : signedKroner(bet.profitOre ?? 0)}
                                </td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        </div>
    );
}
