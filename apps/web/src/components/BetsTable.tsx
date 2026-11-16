import { bookName, brokenScannerRule, pickText, type BrokenScannerRule } from "@closing-line/core";
import type { BetWithFixture, Player } from "@closing-line/db";
import { odds, percent, shortDate, signedKroner, kroner } from "../lib/format.ts";
import { groupBets } from "../lib/groups.ts";
import { SCANNER_RULES } from "../lib/rules.ts";
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

/** The rule today's scanner would stop a bet on, for scanner bets placed before that rule existed. */
export function oldRule(bet: BetWithFixture, player: Pick<Player, "kind"> | undefined): BrokenScannerRule | undefined {
    if (player?.kind !== "scanner" || bet.fixture === null) return undefined;
    return brokenScannerRule(bet, bet.fixture.kickoff, SCANNER_RULES);
}

const OLD_RULE_LABEL: Record<BrokenScannerRule, { tag: string; title: string }> = {
    too_early: {
        tag: `over ${SCANNER_RULES.maxHoursToKickoff} h out`,
        title: `Placed more than ${SCANNER_RULES.maxHoursToKickoff} hours before kickoff; the scanner no longer bets that early`,
    },
    too_late: {
        tag: "closing poll",
        title: "Placed in the pre-kickoff poll, which also sets the closing price; the scanner no longer bets there",
    },
    outsider: {
        tag: "outsider",
        title: `Fair odds of ${SCANNER_RULES.maxFairOdds} or more; the scanner no longer bets outsiders`,
    },
    small_kelly: {
        tag: "edge too small",
        title: "The edge was too small for the odds (Kelly fraction under today's minimum)",
    },
};

function OldRule({ rule }: { rule: BrokenScannerRule }) {
    const { tag, title } = OLD_RULE_LABEL[rule];
    return (
        <span
            title={title}
            className="ml-2 rounded bg-zinc-100 px-1.5 py-0.5 text-xs whitespace-nowrap text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400"
        >
            old rule: {tag}
        </span>
    );
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
    const groups = groupBets(bets, now);
    return (
        <>
            <BetList groups={groups} players={players} />
            <div className="hidden overflow-x-auto rounded-xl border border-zinc-200 md:block dark:border-zinc-800">
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
                    {groups.map((group) => (
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
                                const broken = oldRule(bet, player);
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
                                        <td className="px-3 py-2 whitespace-nowrap text-zinc-500">
                                            {reason(bet, player)}
                                            {broken && <OldRule rule={broken} />}
                                        </td>
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
                                            {result(bet)}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    ))}
                </table>
            </div>
        </>
    );
}

function result(bet: BetWithFixture): string {
    return bet.status === "open" ? "open" : signedKroner(bet.profitOre ?? 0);
}

/** Phones: one block per bet, match and pick first, so nothing important is off screen. */
function BetList({ groups, players }: { groups: ReturnType<typeof groupBets>; players: Map<string, Player> }) {
    return (
        <div className="space-y-4 md:hidden" data-testid="bets-list">
            {groups.map((group) => (
                <section key={`${group.label}-${group.bets[0]?.id ?? ""}`}>
                    <h3 className="mb-1 text-xs font-semibold text-zinc-600 dark:text-zinc-300">{group.label}</h3>
                    <ul className="divide-y divide-zinc-100 rounded-xl border border-zinc-200 dark:divide-zinc-900 dark:border-zinc-800">
                        {group.bets.map((bet) => {
                            const player = players.get(bet.playerId);
                            const broken = oldRule(bet, player);
                            return (
                                <li key={bet.id} className="px-3 py-2 text-sm" data-testid="bet-item">
                                    <div className="flex items-baseline justify-between gap-3">
                                        <span className="font-medium">{match(bet)}</span>
                                        <span className={`tabular-nums whitespace-nowrap ${STATUS_STYLE[bet.status]}`}>
                                            {result(bet)}
                                        </span>
                                    </div>
                                    <div className="text-zinc-600 dark:text-zinc-300">
                                        {pick(bet)} @ {odds(bet.lockedOdds)} · {bookName(bet.bookmaker)} ·{" "}
                                        {kroner(bet.stakeOre)}
                                    </div>
                                    <div className="flex flex-wrap items-center gap-x-2 text-xs text-zinc-500">
                                        <span>
                                            <span
                                                className="mr-1 inline-block size-2 rounded-full"
                                                style={{ background: player ? playerColour(player) : undefined }}
                                            />
                                            {player?.name ?? bet.playerId}
                                        </span>
                                        <span>
                                            {bet.fixture
                                                ? shortDate(bet.fixture.kickoff)
                                                : `logged ${shortDate(bet.receivedAt ?? bet.createdAt)}`}
                                        </span>
                                        {bet.clv !== null && <span>CLV {percent(bet.clv)}</span>}
                                        {reason(bet, player) && <span>{reason(bet, player)}</span>}
                                        {broken && <OldRule rule={broken} />}
                                    </div>
                                </li>
                            );
                        })}
                    </ul>
                </section>
            ))}
        </div>
    );
}
