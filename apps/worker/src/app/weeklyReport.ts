import type { Config } from "@closing-line/config";
import {
    calibration,
    cashoutGainOre,
    forecastScores,
    OUTCOMES,
    outcomeOf,
    priceMove,
    statsBy,
    statsFromTotals,
    tipLifetime,
    totalsOf,
    type LaterPrice,
    type MatchForecast,
    type PlayerStats,
} from "@closing-line/core";
import type { Bet, DecisionWithResult, Repositories } from "@closing-line/db";
import { TAGS } from "./betFlow.ts";
import { SCANNER } from "./players.ts";

const WEEK_MS = 7 * 86_400_000;
/** Settled bets a player needs before its results mean much (the spec's go-live rule). */
const BETS_TO_JUDGE = 300;
/** Settled bets per reason before comparing reasons is worth a lesson. */
const LESSON_MIN_BETS = 5;

const TAG_LABELS: Record<string, string> = Object.fromEntries(
    Object.values(TAGS).map(({ tag, label }) => [tag, label]),
);

/** General lessons, one a week in turn, until the results themselves teach something. */
export const LESSONS = [
    "Value is not the same as winning. A bet at 3.00 that is really worth 2.80 still loses about two times in three; judge tips over a hundred bets, not one weekend.",
    "When the odds drop after you bet, the market agrees with you. Beating the closing price over many bets is the best sign of skill, long before the profit shows.",
    "Keep stakes small: a few percent of your betting money per bet. Ten losses in a row happen even with good bets.",
    "A bookmaker's odds add up to more than 100%; the extra is their margin. Comparing books before you bet is the cheapest edge there is.",
    "Small samples lie. Twenty bets can show +40% or −40% by luck alone; wait for hundreds before trusting a result.",
    "Cashing out usually costs money: the cash-out price carries an extra margin. Cash out when your reason for the bet has changed, not because you are nervous.",
    "Over 0.5 and over 1.5 shots on the same player is one opinion, not two. Size laddered bets together, as one position.",
];

export interface WeeklyReportDeps {
    repos: Pick<Repositories, "players" | "bets" | "apiUsage" | "decisions">;
    config: Pick<Config, "timezone" | "leagues">;
    now: () => Date;
}

/** One message: every player's week and all-time results, bettors' breakdowns, a lesson, and the credit balance. */
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
    const lessons: string[] = [];

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
        if (player.kind === "bettor") {
            const breakdown = bettorBreakdown(player.name, await deps.repos.bets.forPlayer(player.id));
            lines.push(...breakdown.lines);
            lessons.push(...breakdown.lessons);
        }
    }

    lines.push(...tipsSection(await deps.repos.bets.withLaterPrices(SCANNER, weekStart)));
    lines.push(...decisionsSection(await deps.repos.decisions.since(weekStart)));
    const leagueNames = new Map(deps.config.leagues.map((league) => [league.oddsApiKey, league.name]));
    lines.push(
        ...allTimeSection(
            await deps.repos.decisions.since(new Date(0)),
            await deps.repos.bets.settledWithFixture(SCANNER),
            leagueNames,
        ),
    );

    lines.push("", "📚 Lesson of the week", lessons[0] ?? LESSONS[weekNumber(now) % LESSONS.length] ?? "");

    const usage = await deps.repos.apiUsage.latest("odds-api");
    if (usage) lines.push("", `Odds API: ${usage.used} credits used this month, ${usage.remaining} left.`);
    if (mostSettled < BETS_TO_JUDGE) {
        lines.push(`Too early to judge: ${mostSettled} of ${BETS_TO_JUDGE} settled bets so far.`);
    }
    return lines.join("\n");
}

/**
 * The week's tips (the scanner's bets): how many there were, how often the price was still on offer at the next
 * poll and just before kickoff, and what that means for how fast to act on one.
 */
export function tipsSection(tips: readonly { bet: Bet; later: LaterPrice[] }[]): string[] {
    if (tips.length === 0) return [];
    const lifetimes = tips.map(({ bet, later }) => tipLifetime({ odds: bet.lockedOdds, sentAt: bet.createdAt }, later));
    const share = (answers: (boolean | undefined)[]) => {
        const seen = answers.filter((answer) => answer !== undefined);
        return { kept: seen.filter(Boolean).length, seen: seen.length };
    };
    const next = share(lifetimes.map((lifetime) => lifetime.nextPoll));
    const closing = share(lifetimes.map((lifetime) => lifetime.atClosing));
    const clvs = tips.flatMap(({ bet }) => (bet.clv === null ? [] : [bet.clv]));
    const lines = ["", `🔎 Tips this week: ${tips.length}`];
    if (next.seen > 0) lines.push(`Price still there at the next poll: ${next.kept} of ${next.seen}`);
    if (closing.seen > 0) lines.push(`Price still there just before kickoff: ${closing.kept} of ${closing.seen}`);
    if (clvs.length > 0) {
        const average = clvs.reduce((sum, clv) => sum + clv, 0) / clvs.length;
        lines.push(`Average CLV: ${percent(average)} over ${clvs.length} with a closing price`);
    }
    // Advice once there is enough to go on; a handful of tips says little either way.
    if (closing.seen >= LESSON_MIN_BETS) {
        lines.push(
            closing.kept / closing.seen < 0.5
                ? "Most tip prices are gone by kickoff: bet soon after a tip arrives."
                : "Most tip prices last until kickoff: there is time to compare books before betting.",
        );
    }
    return lines;
}

const PASS_REASONS: Record<string, string> = {
    no_edge: "no edge",
    no_fresh_sharp: "no fresh Pinnacle price",
    stake_too_small: "stake below the minimum",
    paused: "scanner paused",
    already_bet: "already bet",
    too_early: "too far from kickoff",
    too_late: "too close to kickoff",
};

/**
 * What the scanner decided this week: how often it bet, why it passed, and how backing the best price on each
 * no-edge pass would have done, flat stakes on settled matches. A loss there means passing was right.
 */
export function decisionsSection(decisions: readonly DecisionWithResult[]): string[] {
    if (decisions.length === 0) return [];
    const matches = new Set(decisions.map((decision) => decision.fixtureId)).size;
    const bets = decisions.filter((decision) => decision.outcome === "bet").length;
    const passes = decisions.length - bets;
    const lines = [
        "",
        `🧭 Decisions this week: ${matches} matches looked at ${decisions.length} times, ${bets} bet, ${passes} passed ` +
            `(${percentPlain(bets / decisions.length)} bet rate)`,
    ];
    const reasons = Object.entries(PASS_REASONS).flatMap(([reason, label]) => {
        const count = decisions.filter((decision) => decision.reason === reason).length;
        return count > 0 ? [`${count} ${label}`] : [];
    });
    if (reasons.length > 0) lines.push(`Passed for: ${reasons.join(", ")}`);

    const settled = decisions.flatMap((decision) =>
        decision.reason === "no_edge" &&
        decision.status === "finished" &&
        decision.bestOdds !== null &&
        decision.homeGoals !== null &&
        decision.awayGoals !== null
            ? [
                  outcomeOf(decision.homeGoals, decision.awayGoals) === decision.bestSelection
                      ? decision.bestOdds - 1
                      : -1,
              ]
            : [],
    );
    if (settled.length > 0) {
        const roi = settled.reduce((sum, result) => sum + result, 0) / settled.length;
        lines.push(
            `Backing the best price on each settled no-edge pass would have returned ${percent(roi)} over ${settled.length}.`,
        );
    }
    return lines;
}

/** Settled matches before calibration says much; three forecasts each. */
const CALIBRATION_MIN_MATCHES = 50;
const CALIBRATION_BAND_MIN = 20;
/** Pinnacle's early-price log loss over 20,839 matches, 2020/21 to 2025/26 (ADR 0011). */
const BACKTEST_PINNACLE_EARLY_LOG_LOSS = 1.0073;
/** Settled bets in a league or timing group before it is shown. */
const GROUP_MIN_BETS = 10;

/**
 * All-time insight once there is enough of it: how well Pinnacle's fair probabilities matched what happened (each
 * match's first decision, so no match counts twice), and the scanner's results by league and by how long before
 * kickoff it bet.
 */
export function allTimeSection(
    decisions: readonly DecisionWithResult[],
    scannerBets: readonly (Bet & { league: string; kickoff: Date })[],
    leagueNames: ReadonlyMap<string, string>,
): string[] {
    const lines = ["", "📐 All time"];
    const firstPerMatch = new Map<string, DecisionWithResult>();
    for (const decision of decisions) {
        if (decision.fairHome === null || decision.status !== "finished" || firstPerMatch.has(decision.fixtureId)) {
            continue;
        }
        firstPerMatch.set(decision.fixtureId, decision);
    }
    const matchForecasts: MatchForecast[] = [...firstPerMatch.values()].flatMap((decision) =>
        decision.homeGoals === null || decision.awayGoals === null
            ? []
            : [
                  {
                      probabilities: {
                          home: decision.fairHome ?? 0,
                          draw: decision.fairDraw ?? 0,
                          away: decision.fairAway ?? 0,
                      },
                      result: outcomeOf(decision.homeGoals, decision.awayGoals),
                  },
              ],
    );
    const forecasts = matchForecasts.flatMap(({ probabilities, result }) =>
        OUTCOMES.map((outcome) => ({ probability: probabilities[outcome], happened: outcome === result })),
    );
    const matches = matchForecasts.length;
    if (matches < CALIBRATION_MIN_MATCHES) {
        lines.push(`Calibration: ${matches} of ${CALIBRATION_MIN_MATCHES} settled matches so far.`);
    } else {
        lines.push(`Calibration of Pinnacle's fair prices over ${matches} matches:`);
        for (const band of calibration(forecasts, 0.2, CALIBRATION_BAND_MIN)) {
            lines.push(
                `${Math.round(band.from * 100)}–${percentPlain(band.to)}: said ${percentPlain(band.averageProbability)}, ` +
                    `happened ${percentPlain(band.observedRate)} (${band.count})`,
            );
        }
        const scores = forecastScores(matchForecasts);
        if (scores) {
            lines.push(
                `Log loss ${scores.logLoss.toFixed(3)} (Pinnacle's early price in the back-test: ` +
                    `${BACKTEST_PINNACLE_EARLY_LOG_LOSS.toFixed(3)}), Brier ${scores.brier.toFixed(3)}. Lower is better.`,
            );
        }
    }

    const groups = (title: string, keyOf: (bet: (typeof scannerBets)[number]) => string) => {
        const shown = [...statsBy(scannerBets, keyOf)].filter(([, stats]) => stats.settled >= GROUP_MIN_BETS);
        if (shown.length === 0) return;
        lines.push(title);
        for (const [key, stats] of shown) {
            lines.push(`${key}: ${stats.settled} bets, ROI ${percent(stats.roi)}, CLV ${percent(stats.averageClv)}`);
        }
    };
    groups("Scanner by league:", (bet) => leagueNames.get(bet.league) ?? bet.league);
    groups("Scanner by time before kickoff:", (bet) => {
        const hours = (bet.kickoff.getTime() - bet.createdAt.getTime()) / 3_600_000;
        if (hours < 2) return "under 2 h";
        if (hours < 12) return "2–12 h";
        return hours < 72 ? "12–72 h" : "3 days or more";
    });
    return lines;
}

/** A bettor's results by reason and sport and their cash-outs, plus the lessons their numbers support. */
export function bettorBreakdown(name: string, bets: readonly Bet[]): { lines: string[]; lessons: string[] } {
    const lines: string[] = [];
    const lessons: string[] = [];
    if (bets.length === 0) return { lines, lessons };

    const byTag = statsBy(bets, (bet) => bet.tag);
    if (byTag.size > 0) lines.push(`By reason: ${groupText(byTag, (tag) => TAG_LABELS[tag] ?? tag)}`);
    const bySport = statsBy(bets, (bet) => (bet.sport === "counter_strike" ? "Counter-Strike" : "Football"));
    if (bySport.size > 1) lines.push(`By sport: ${groupText(bySport, (sport) => sport)}`);

    const cashed = bets.filter((bet) => bet.status === "cashed_out");
    if (cashed.length > 0) {
        const moves = cashed.flatMap((bet) =>
            bet.impliedCurrentOdds === null ? [] : [priceMove(bet.lockedOdds, bet.impliedCurrentOdds)],
        );
        const answered = cashed.flatMap((bet) =>
            bet.heldStatus === null || bet.heldStatus === "open" || bet.heldStatus === "cashed_out"
                ? []
                : [{ bet, held: bet.heldStatus }],
        );
        const gain = answered.reduce(
            (total, { bet, held }) =>
                total + cashoutGainOre({ ...bet, cashoutOfferOre: bet.cashoutOfferOre ?? 0 }, held),
            0,
        );
        const move = moves.length > 0 ? `, price moved ${percent(average(moves))} on average` : "";
        const versus = answered.length > 0 ? `; against holding: ${money(gain)} over ${answered.length}` : "";
        lines.push(`Cash-outs: ${cashed.length}${move}${versus}`);
        if (answered.length >= 3) {
            lessons.push(
                gain >= 0
                    ? `${name}'s cash-outs paid ${kroner(gain)} more than holding over ${answered.length} bets: so far cashing out has protected money.`
                    : `${name}'s cash-outs cost ${kroner(-gain)} compared with holding over ${answered.length} bets: the bets kept going their way after the cash-out.`,
            );
        }
    }

    const ranked = [...byTag]
        .filter(([, stats]) => stats.settled >= LESSON_MIN_BETS)
        .sort((a, b) => (b[1].roi ?? 0) - (a[1].roi ?? 0));
    const [best, worst] = [ranked[0], ranked.at(-1)];
    if (ranked.length >= 2 && best && worst) {
        const label = (tag: string) => TAG_LABELS[tag] ?? tag;
        lessons.unshift(
            `${name}'s ${label(best[0])} bets return ${percent(best[1].roi)} over ${best[1].settled}, ` +
                `${label(worst[0])} bets ${percent(worst[1].roi)} over ${worst[1].settled}. ` +
                "Lean towards what works, but small samples can still be luck.",
        );
    }
    return { lines, lessons };
}

function groupText(groups: Map<string, PlayerStats>, label: (key: string) => string): string {
    return [...groups]
        .map(([key, stats]) => `${label(key)} ${stats.settled} settled, ROI ${percent(stats.roi)}`)
        .join(" · ");
}

function average(values: number[]): number {
    return values.reduce((total, value) => total + value, 0) / values.length;
}

/** Whole weeks since the epoch, to rotate the general lessons. */
function weekNumber(date: Date): number {
    return Math.floor(date.getTime() / WEEK_MS);
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

function percentPlain(value: number): string {
    return `${(value * 100).toFixed(0)}%`;
}
