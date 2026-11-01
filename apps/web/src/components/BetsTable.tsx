import type { BetWithFixture, Player } from "@closing-line/db";
import { odds, percent, shortDate, signedKroner, kroner } from "../lib/format.ts";
import { playerColour } from "./players.ts";

const STATUS_STYLE: Record<BetWithFixture["status"], string> = {
    open: "text-zinc-500",
    won: "text-emerald-600 dark:text-emerald-400",
    lost: "text-rose-600 dark:text-rose-400",
    void: "text-zinc-400",
};

function pick(bet: BetWithFixture): string {
    if (bet.selection === "home") return bet.fixture.homeTeam;
    if (bet.selection === "away") return bet.fixture.awayTeam;
    return "Draw";
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
                        <th className="px-3 py-2 text-right font-medium">Odds</th>
                        <th className="px-3 py-2 text-right font-medium">Stake</th>
                        <th className="px-3 py-2 text-right font-medium">CLV</th>
                        <th className="px-3 py-2 text-right font-medium">Result</th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 dark:divide-zinc-900">
                    {bets.map((bet) => {
                        const player = players.get(bet.playerId);
                        return (
                            <tr key={bet.id}>
                                <td className="px-3 py-2 whitespace-nowrap text-zinc-500">
                                    {shortDate(bet.fixture.kickoff)}
                                </td>
                                <td className="px-3 py-2 whitespace-nowrap">
                                    <span
                                        className="mr-2 inline-block size-2 rounded-full"
                                        style={{ background: player ? playerColour(player) : undefined }}
                                    />
                                    {player?.name ?? bet.playerId}
                                </td>
                                <td className="px-3 py-2 whitespace-nowrap">
                                    {bet.fixture.homeTeam} v {bet.fixture.awayTeam}
                                </td>
                                <td className="px-3 py-2 whitespace-nowrap">{pick(bet)}</td>
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
