import { settle1x2, type Outcome } from "@closing-line/core";
import type { Repositories } from "@closing-line/db";

const TEAMS = [
    "Arsenal",
    "Aston Villa",
    "Bournemouth",
    "Brentford",
    "Brighton and Hove Albion",
    "Chelsea",
    "Coventry City",
    "Crystal Palace",
    "Everton",
    "Fulham",
    "Hull City",
    "Ipswich Town",
    "Leeds United",
    "Liverpool",
    "Manchester City",
    "Manchester United",
    "Newcastle United",
    "Nottingham Forest",
    "Sunderland",
    "Tottenham Hotspur",
];
const DAY_MS = 86_400_000;
const WEEKS = 10;

/** A small deterministic random generator, so the demo looks the same on every start. */
function random(seed: number): () => number {
    let state = seed;
    return () => {
        state = (state + 0x6d2b79f5) | 0;
        let t = Math.imul(state ^ (state >>> 15), 1 | state);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
    };
}

const DEMO_TAGS = ["lineup", "skewed_price", "game_read"] as const;

/**
 * Fills an empty database with ten weeks of made-up Premier League bets for every player, so the dashboard can be
 * shown without real data or API keys. The value scanner and the friend get a small real edge; the favourite none.
 */
export async function seedDemo(repos: Repositories, now: Date): Promise<void> {
    const next = random(42);
    await repos.players.ensure([
        { id: "scanner", name: "Value scanner", kind: "scanner", startingBankrollOre: 1_000_000 },
        { id: "favourite", name: "Always the favourite", kind: "benchmark", startingBankrollOre: 1_000_000 },
        { id: "friend", name: "Friend (demo)", kind: "human", startingBankrollOre: 1_000_000 },
    ]);

    const firstSaturday = new Date(now.getTime() - WEEKS * 7 * DAY_MS);
    firstSaturday.setUTCHours(15, 0, 0, 0);
    for (let week = 0; week <= WEEKS; week++) {
        const order = [...TEAMS].sort(() => next() - 0.5);
        for (let match = 0; match < 10; match++) {
            const kickoff = new Date(firstSaturday.getTime() + week * 7 * DAY_MS + (match % 3) * 2.5 * 3_600_000);
            const id = `demo${String(week).padStart(2, "0")}${String(match).padStart(2, "0")}`.padEnd(32, "0");
            const homeTeam = order[match * 2] ?? "Arsenal";
            const awayTeam = order[match * 2 + 1] ?? "Chelsea";
            await repos.fixtures.upsert([{ id, league: "soccer_epl", homeTeam, awayTeam, kickoff }]);

            // True chances for this match, and Pinnacle-like fair odds around them.
            const home = 0.3 + next() * 0.35;
            const draw = 0.22 + next() * 0.06;
            const chances: Record<Outcome, number> = { home, draw, away: Math.max(0.08, 1 - home - draw) };
            const roll = next();
            const outcome: Outcome =
                roll < chances.home ? "home" : roll < chances.home + chances.draw ? "draw" : "away";
            const result = {
                status: "finished" as const,
                homeGoals: outcome === "home" ? 2 : 1,
                awayGoals: outcome === "away" ? 2 : 1,
            };
            const finished = kickoff.getTime() + 2 * 3_600_000 < now.getTime();

            const favourite: Outcome = chances.home >= chances.away ? "home" : "away";
            const bets: { playerId: string; selection: Outcome; edge: number; stakeOre: number }[] = [
                { playerId: "favourite", selection: favourite, edge: -0.03, stakeOre: 10_000 },
            ];
            // Value bettors pick realistic prices (a 25% chance or better), not longshots.
            const realistic = (["home", "draw", "away"] as const).filter((selection) => chances[selection] >= 0.25);
            const choose = () => realistic[Math.floor(next() * realistic.length)] ?? favourite;
            if (next() < 0.35)
                bets.push({
                    playerId: "scanner",
                    selection: choose(),
                    edge: 0.03 + next() * 0.04,
                    stakeOre: 8_000 + Math.round(next() * 8) * 1_000,
                });
            if (next() < 0.45)
                bets.push({
                    playerId: "friend",
                    selection: choose(),
                    edge: -0.01 + next() * 0.05,
                    stakeOre: 10_000 + Math.round(next() * 15) * 1_000,
                });

            for (const demoBet of bets) {
                const fairOdds = 1 / chances[demoBet.selection];
                const lockedOdds = Math.round(fairOdds * (1 + demoBet.edge) * 100) / 100;
                const placed = await repos.bets.place({
                    playerId: demoBet.playerId,
                    fixtureId: id,
                    market: "h2h",
                    selection: demoBet.selection,
                    stakeOre: demoBet.stakeOre,
                    lockedOdds,
                    bookmaker: demoBet.playerId === "favourite" ? "pinnacle" : next() < 0.5 ? "unibet_se" : "betsson",
                    // The friend's bets come from Telegram with a reason; some are typed rather than screenshots.
                    ...(demoBet.playerId === "friend"
                        ? {
                              selfReported: true,
                              tag: DEMO_TAGS[Math.floor(next() * DEMO_TAGS.length)] ?? "game_read",
                              screenshotPath: next() < 0.7 ? "demo.jpeg" : null,
                          }
                        : {}),
                    sharpFairOddsAtBet: fairOdds,
                    edgeAtBet: demoBet.edge,
                });
                if (!placed || !finished) continue;
                const closingFairOdds = fairOdds * (1 - demoBet.edge * 0.6 + (next() - 0.5) * 0.04);
                await repos.bets.setClosing(placed.id, {
                    fairOdds: closingFairOdds,
                    clv: lockedOdds / closingFairOdds - 1,
                    provisional: false,
                });
                const settlement = settle1x2(
                    { selection: demoBet.selection, stakeOre: demoBet.stakeOre, decimalOdds: lockedOdds },
                    result,
                );
                await repos.bets.settle(placed.id, {
                    ...settlement,
                    settledAt: new Date(kickoff.getTime() + 2 * 3_600_000),
                });
            }
            if (finished) await repos.fixtures.setResult(id, result);
        }
    }
    await repos.apiUsage.record({ provider: "odds-api", takenAt: now, used: 61, remaining: 439, lastCost: 1 });
}
