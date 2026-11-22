import { bookName, brokenScannerRule, pickText, type BrokenScannerRule } from "@closing-line/core";
import type { BetWithFixture, Player } from "@closing-line/db";
import { odds, percent, shortDate, signedKroner, kroner } from "../lib/format.ts";
import { groupBets, startOf } from "../lib/groups.ts";
import { SCANNER_RULES, TIME_ZONE } from "../lib/rules.ts";
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
        // The scanner's 1X2 bets: the team itself.
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

/** Everything one bet shows, worked out once for both the desktop table and the phone list. */
interface BetRow {
    id: string;
    player: string;
    colour: string | undefined;
    /** Kickoff, or when the bet was logged for a match we don't track. */
    when: string;
    logged: boolean;
    match: string;
    pick: string;
    book: string;
    reason: string;
    oldRule: BrokenScannerRule | undefined;
    odds: string;
    stake: string;
    clv: string | undefined;
    result: string;
    resultStyle: string;
}

function betRow(bet: BetWithFixture, players: Map<string, Player>): BetRow {
    const player = players.get(bet.playerId);
    return {
        id: bet.id,
        player: player?.name ?? bet.playerId,
        colour: player ? playerColour(player) : undefined,
        when: shortDate(startOf(bet), TIME_ZONE),
        logged: bet.fixture === null,
        match: match(bet),
        pick: pick(bet),
        book: bookName(bet.bookmaker),
        reason: reason(bet, player),
        oldRule: oldRule(bet, player),
        odds: odds(bet.lockedOdds),
        stake: kroner(bet.stakeOre),
        clv: bet.clv === null ? undefined : percent(bet.clv),
        result: bet.status === "open" ? "open" : signedKroner(bet.profitOre ?? 0),
        resultStyle: STATUS_STYLE[bet.status],
    };
}

/** The desktop table's columns; the group headings span all of them. */
const COLUMNS: { label: string; right?: true; title?: string }[] = [
    { label: "Match time" },
    { label: "Player" },
    { label: "Match" },
    { label: "Pick" },
    { label: "Bookmaker" },
    { label: "Reason" },
    { label: "Odds", right: true },
    { label: "Stake", right: true },
    {
        label: "CLV",
        right: true,
        title: "Closing line value: the odds taken against Pinnacle's fair price just before kickoff",
    },
    { label: "Result", right: true },
];

interface RowGroup {
    key: string;
    label: string;
    rows: BetRow[];
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
    const groups: RowGroup[] = groupBets(bets, now).map((group) => ({
        key: `${group.label}-${group.bets[0]?.id ?? ""}`,
        label: group.label,
        rows: group.bets.map((bet) => betRow(bet, players)),
    }));
    return (
        <>
            <BetList groups={groups} />
            <div className="hidden overflow-x-auto rounded-xl border border-zinc-200 md:block dark:border-zinc-800">
                <table className="w-full text-sm" data-testid="bets-table">
                    <thead className="bg-zinc-50 text-left text-xs text-zinc-500 dark:bg-zinc-900">
                        <tr>
                            {COLUMNS.map((column) => (
                                <th
                                    key={column.label}
                                    className={`px-3 py-2 font-medium ${column.right ? "text-right" : ""}`}
                                    title={column.title}
                                >
                                    {column.label}
                                </th>
                            ))}
                        </tr>
                    </thead>
                    {groups.map((group) => (
                        <tbody key={group.key} className="divide-y divide-zinc-100 dark:divide-zinc-900">
                            <tr className="bg-zinc-50/60 dark:bg-zinc-900/60">
                                <th
                                    colSpan={COLUMNS.length}
                                    scope="colgroup"
                                    className="px-3 pt-4 pb-1 text-left text-xs font-semibold text-zinc-600 dark:text-zinc-300"
                                >
                                    {group.label}
                                </th>
                            </tr>
                            {group.rows.map((row) => (
                                <tr key={row.id} data-testid="bet-row">
                                    <td className="px-3 py-2 whitespace-nowrap text-zinc-500">
                                        {row.logged ? (
                                            <span title="Match time unknown: when the bet was logged">
                                                logged {row.when}
                                            </span>
                                        ) : (
                                            row.when
                                        )}
                                    </td>
                                    <td className="px-3 py-2 whitespace-nowrap">
                                        <PlayerDot colour={row.colour} className="mr-2" />
                                        {row.player}
                                    </td>
                                    <td className="px-3 py-2 whitespace-nowrap">{row.match}</td>
                                    <td className="px-3 py-2 whitespace-nowrap">{row.pick}</td>
                                    <td className="px-3 py-2 whitespace-nowrap text-zinc-500">{row.book}</td>
                                    <td className="px-3 py-2 whitespace-nowrap text-zinc-500">
                                        {row.reason}
                                        {row.oldRule && <OldRule rule={row.oldRule} />}
                                    </td>
                                    <td className="px-3 py-2 text-right tabular-nums">{row.odds}</td>
                                    <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">{row.stake}</td>
                                    <td className="px-3 py-2 text-right tabular-nums">{row.clv ?? "–"}</td>
                                    <td
                                        className={`px-3 py-2 text-right tabular-nums whitespace-nowrap ${row.resultStyle}`}
                                    >
                                        {row.result}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    ))}
                </table>
            </div>
        </>
    );
}

function PlayerDot({ colour, className }: { colour: string | undefined; className: string }) {
    return (
        <span
            aria-hidden="true"
            className={`${className} inline-block size-2 rounded-full`}
            style={{ background: colour }}
        />
    );
}

/** Phones: one block per bet, match and pick first, so nothing important is off screen. */
function BetList({ groups }: { groups: RowGroup[] }) {
    return (
        <div className="space-y-4 md:hidden" data-testid="bets-list">
            {groups.map((group) => (
                <section key={group.key}>
                    <h3 className="mb-1 text-xs font-semibold text-zinc-600 dark:text-zinc-300">{group.label}</h3>
                    <ul className="divide-y divide-zinc-100 rounded-xl border border-zinc-200 dark:divide-zinc-900 dark:border-zinc-800">
                        {group.rows.map((row) => (
                            <li key={row.id} className="px-3 py-2 text-sm" data-testid="bet-item">
                                <div className="flex items-baseline justify-between gap-3">
                                    <span className="font-medium">{row.match}</span>
                                    <span className={`tabular-nums whitespace-nowrap ${row.resultStyle}`}>
                                        {row.result}
                                    </span>
                                </div>
                                <div className="text-zinc-600 dark:text-zinc-300">
                                    {row.pick} @ {row.odds} · {row.book} · {row.stake}
                                </div>
                                <div className="flex flex-wrap items-center gap-x-2 text-xs text-zinc-500">
                                    <span>
                                        <PlayerDot colour={row.colour} className="mr-1" />
                                        {row.player}
                                    </span>
                                    <span>{row.logged ? `logged ${row.when}` : row.when}</span>
                                    {row.clv && <span>CLV {row.clv}</span>}
                                    {row.reason && <span>{row.reason}</span>}
                                    {row.oldRule && <OldRule rule={row.oldRule} />}
                                </div>
                            </li>
                        ))}
                    </ul>
                </section>
            ))}
        </div>
    );
}
