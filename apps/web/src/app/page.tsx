import { PercentChart } from "../components/PercentChart.tsx";
import { TIME_ZONE } from "../lib/rules.ts";
import { GoLivePanel } from "../components/GoLivePanel.tsx";
import { BetsTable } from "../components/BetsTable.tsx";
import { Pagination } from "../components/Pagination.tsx";
import { PlayerFilter } from "../components/PlayerFilter.tsx";
import { PlayerCard } from "../components/PlayerCard.tsx";
import { playerColour } from "../components/players.ts";
import { BETS_PER_PAGE, isRanked, loadDashboard } from "../lib/data.ts";

// Always read fresh data: the worker settles bets during the day.
export const dynamic = "force-dynamic";

export default async function Home({ searchParams }: { searchParams: Promise<Record<string, string | string[]>> }) {
    const { page: requestedPage, player: requestedPlayer } = await searchParams;
    const dashboard = await loadDashboard(
        typeof requestedPage === "string" ? requestedPage : undefined,
        typeof requestedPlayer === "string" ? requestedPlayer : undefined,
    );
    const { betCounts, page, pages, player } = dashboard;
    const first = (page - 1) * BETS_PER_PAGE + 1;
    const players = new Map(dashboard.players.map((summary) => [summary.player.id, summary.player]));
    const series = dashboard.players.map(({ player, series: points }) => ({
        id: player.id,
        name: player.name,
        colour: playerColour(player),
        points: points.map((point) => ({
            t: point.at.getTime(),
            value: point.bankrollOre / player.startingBankrollOre - 1,
        })),
    }));

    const clvSeries = dashboard.clvSeries.flatMap(({ playerId, points }) => {
        const owner = players.get(playerId);
        return owner ? [{ id: playerId, name: owner.name, colour: playerColour(owner), points }] : [];
    });

    return (
        <main className="mx-auto max-w-[88rem] space-y-8 px-4 py-8">
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

            {dashboard.goLive && <GoLivePanel check={dashboard.goLive} />}

            <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-label="Leaderboard">
                {dashboard.players.map((summary, index) => (
                    <PlayerCard
                        key={summary.player.id}
                        summary={summary}
                        // Ranked players come first, so their place in the list is their rank.
                        rank={isRanked(summary) ? index + 1 : undefined}
                    />
                ))}
            </section>

            <section className="space-y-3">
                <h2 className="font-semibold">Bankroll growth</h2>
                {dashboard.players.some((summary) => summary.stats.settled + summary.stats.void > 0) ? (
                    <PercentChart series={series} timeZone={TIME_ZONE} />
                ) : (
                    <p className="text-sm text-zinc-500">The chart starts with the first settled bet.</p>
                )}
            </section>

            {clvSeries.some((line) => line.points.length > 0) && (
                <section className="space-y-3">
                    <h2 className="font-semibold">Average CLV over time</h2>
                    <p className="text-sm text-zinc-500">
                        Shows skill long before profit does. The scanner&apos;s line counts only bets today&apos;s rules
                        would place.
                    </p>
                    <PercentChart series={clvSeries} timeZone={TIME_ZONE} testId="clv-chart" />
                </section>
            )}

            <section className="space-y-3" id="bets">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <h2 className="font-semibold">Bets</h2>
                    {betCounts.total > 0 && (
                        <p className="text-sm text-zinc-500" data-testid="bet-counts">
                            {betCounts.total.toLocaleString("en-GB")} bets · {betCounts.open.toLocaleString("en-GB")}{" "}
                            open · {betCounts.settled.toLocaleString("en-GB")} settled
                            {pages > 1 &&
                                ` · showing ${first.toLocaleString("en-GB")}–${(first + dashboard.bets.length - 1).toLocaleString("en-GB")}`}
                        </p>
                    )}
                </div>
                <PlayerFilter players={dashboard.players.map((summary) => summary.player)} selected={player} />
                {dashboard.bets.length === 0 ? (
                    <p className="text-sm text-zinc-500">No bets yet.</p>
                ) : (
                    <>
                        <BetsTable bets={dashboard.bets} players={players} />
                        <Pagination page={page} pages={pages} player={player} />
                    </>
                )}
            </section>
        </main>
    );
}
