import { kroner, percent, signedKroner } from "../lib/format.ts";
import { MIN_CLV_BETS_TO_RANK, type PlayerSummary } from "../lib/data.ts";
import { KIND_LABEL, playerColour } from "./players.ts";

/** `rank` is undefined for a player without enough closing prices to rank. */
export function PlayerCard({ summary, rank }: { summary: PlayerSummary; rank: number | undefined }) {
    const { player, stats, bankrollOre, currentRules } = summary;
    return (
        <article
            data-testid="player-card"
            className="rounded-xl border border-zinc-200 p-5 dark:border-zinc-800"
            style={{ borderTop: `4px solid ${playerColour(player)}` }}
        >
            <header className="flex items-baseline justify-between gap-3">
                <h2 className="font-semibold">
                    {rank !== undefined && <span className="mr-2 text-zinc-400">#{rank}</span>}
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
            {currentRules && currentRules.clvCount < stats.clvCount && (
                <p className="mt-3 text-xs text-zinc-500" data-testid="current-rules">
                    Under today&apos;s rules: CLV {percent(currentRules.averageClv)} over {currentRules.clvCount} bets
                </p>
            )}
            {rank === undefined && (
                <p className="mt-3 text-xs text-zinc-500">
                    Not ranked: ranking needs {MIN_CLV_BETS_TO_RANK} bets with a closing price, {stats.clvCount} so far.
                </p>
            )}
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
