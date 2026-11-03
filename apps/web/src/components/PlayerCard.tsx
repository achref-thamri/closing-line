import { kroner, percent, signedKroner } from "../lib/format.ts";
import type { PlayerSummary } from "../lib/data.ts";
import { KIND_LABEL, playerColour } from "./players.ts";

export function PlayerCard({ summary, rank }: { summary: PlayerSummary; rank: number }) {
    const { player, stats, bankrollOre } = summary;
    return (
        <article
            data-testid="player-card"
            className="rounded-xl border border-zinc-200 p-5 dark:border-zinc-800"
            style={{ borderTop: `4px solid ${playerColour(player)}` }}
        >
            <header className="flex items-baseline justify-between gap-3">
                <h2 className="font-semibold">
                    <span className="mr-2 text-zinc-400">#{rank}</span>
                    {player.name}
                </h2>
                <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                    {KIND_LABEL[player.kind]}
                </span>
            </header>
            <p className="mt-3 text-3xl font-semibold tabular-nums">{kroner(bankrollOre)}</p>
            <p className="text-sm text-zinc-500 tabular-nums">
                {signedKroner(stats.profitOre)} profit ({percent(summary.growth)} since the start)
            </p>
            <dl className="mt-4 grid grid-cols-3 gap-2 text-sm">
                <Stat label="ROI" value={percent(stats.roi)} />
                <Stat label="Avg CLV" value={percent(stats.averageClv)} />
                <Stat label="Settled" value={`${stats.settled} (${stats.won} won)`} />
            </dl>
            {stats.open > 0 && <p className="mt-3 text-xs text-zinc-500">{stats.open} open</p>}
        </article>
    );
}

function Stat({ label, value }: { label: string; value: string }) {
    return (
        <div>
            <dt className="text-xs text-zinc-500">{label}</dt>
            <dd className="font-medium tabular-nums">{value}</dd>
        </div>
    );
}
