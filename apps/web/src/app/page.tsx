import { BankrollChart } from "../components/BankrollChart.tsx";
import { BetsTable } from "../components/BetsTable.tsx";
import { PlayerCard } from "../components/PlayerCard.tsx";
import { playerColour } from "../components/players.ts";
import { loadDashboard } from "../lib/data.ts";

// Always read fresh data: the worker settles bets during the day.
export const dynamic = "force-dynamic";

export default async function Home() {
    const dashboard = await loadDashboard();
    const players = new Map(dashboard.players.map((summary) => [summary.player.id, summary.player]));
    const series = dashboard.players.map(({ player, series: points }) => ({
        id: player.id,
        name: player.name,
        colour: playerColour(player),
        points: points.map((point) => ({ t: point.at.getTime(), kr: Math.round(point.bankrollOre / 100) })),
    }));

    return (
        <main className="mx-auto max-w-6xl space-y-8 px-4 py-8">
            <header className="flex flex-wrap items-end justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-semibold">Closing Line</h1>
                    <p className="text-sm text-zinc-500">
                        Paper bets on European football, measured against the closing line.
                    </p>
                </div>
                <div className="flex items-center gap-3 text-sm text-zinc-500">
                    {dashboard.credits && (
                        <span>
                            Odds API: {dashboard.credits.remaining} of{" "}
                            {dashboard.credits.used + dashboard.credits.remaining} credits left
                        </span>
                    )}
                    {dashboard.demo && (
                        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
                            Demo data
                        </span>
                    )}
                </div>
            </header>

            <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-label="Leaderboard">
                {dashboard.players.map((summary, index) => (
                    <PlayerCard key={summary.player.id} summary={summary} rank={index + 1} />
                ))}
            </section>

            <section className="space-y-3">
                <h2 className="font-semibold">Bankroll</h2>
                {dashboard.players.some((summary) => summary.stats.settled + summary.stats.void > 0) ? (
                    <BankrollChart series={series} />
                ) : (
                    <p className="text-sm text-zinc-500">The chart starts with the first settled bet.</p>
                )}
            </section>

            <section className="space-y-3">
                <h2 className="font-semibold">Latest bets</h2>
                {dashboard.recentBets.length === 0 ? (
                    <p className="text-sm text-zinc-500">No bets yet.</p>
                ) : (
                    <BetsTable bets={dashboard.recentBets} players={players} />
                )}
            </section>
        </main>
    );
}
