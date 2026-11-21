import type { LaterPrice, PlayerTotals } from "@closing-line/core";
import { and, desc, eq, gt, gte, inArray, isNotNull, isNull, sql, type SQL } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import type { Database } from "./client.ts";
import type { Fixture } from "./repositories.ts";
import { bets, fixtures, oddsSnapshots } from "./schema.ts";

export type Bet = typeof bets.$inferSelect;
export type NewBet = Omit<
    typeof bets.$inferInsert,
    "id" | "status" | "closingFairOdds" | "clv" | "profitOre" | "settledAt"
>;
/** `fixture` is null for bets on events we do not track, which carry `eventName` instead. */
export type BetWithFixture = Bet & { fixture: Pick<Fixture, "homeTeam" | "awayTeam" | "kickoff" | "league"> | null };

export interface Settlement {
    status: "won" | "lost" | "void" | "cashed_out";
    profitOre: number;
    settledAt: Date;
    cashoutOfferOre?: number;
    impliedCurrentOdds?: number;
}

/** Bets of every player: placing them, closing prices, settlement, and the reads behind the reports and dashboard. */
export function betRepository(db: Database) {
    return {
        /** Places a bet unless the player already backed this selection; returns the bet only when placed. */
        async place(bet: NewBet): Promise<Bet | undefined> {
            const [row] = await db
                .insert(bets)
                .values({ ...bet, id: uuidv7() })
                .onConflictDoNothing()
                .returning();
            return row;
        },
        open(fixtureIds?: string[]): Promise<Bet[]> {
            return db
                .select()
                .from(bets)
                .where(and(eq(bets.status, "open"), fixtureIds && inArray(bets.fixtureId, fixtureIds)))
                .orderBy(bets.createdAt);
        },
        /**
         * Bets with their match, for the dashboard table: open bets first, soonest kickoff first (a bet on an
         * untracked match by when it was logged), then settled bets, latest result first. `offset` skips that
         * many for paging.
         */
        async listing(limit: number, playerId?: string, offset = 0): Promise<BetWithFixture[]> {
            const rows = await db
                .select({
                    bet: bets,
                    fixture: {
                        homeTeam: fixtures.homeTeam,
                        awayTeam: fixtures.awayTeam,
                        kickoff: fixtures.kickoff,
                        league: fixtures.league,
                    },
                })
                .from(bets)
                .leftJoin(fixtures, eq(bets.fixtureId, fixtures.id))
                .where(playerId ? eq(bets.playerId, playerId) : undefined)
                .orderBy(
                    sql`${bets.status} = 'open' desc`,
                    sql`case when ${bets.status} = 'open' then coalesce(${fixtures.kickoff}, ${bets.receivedAt}, ${bets.createdAt}) end asc`,
                    desc(bets.settledAt),
                    desc(bets.createdAt),
                    desc(bets.id),
                )
                .limit(limit)
                .offset(offset);
            return rows.map((row) => ({ ...row.bet, fixture: row.fixture }));
        },
        /**
         * Per-player sums computed by Postgres, so bankrolls and reports never load a player's whole history.
         * With `settledSince`, only bets settled at or after it count (open bets are left out).
         */
        async totals(options: { settledSince?: Date } = {}): Promise<Map<string, PlayerTotals>> {
            const decided = sql`${bets.status} in ('won', 'lost', 'cashed_out')`;
            const count = (condition: SQL) => sql<number>`count(*) filter (where ${condition})`.mapWith(Number);
            const sum = (column: SQL, condition: SQL) =>
                sql<number>`coalesce(sum(${column}) filter (where ${condition}), 0)`.mapWith(Number);
            const rows = await db
                .select({
                    playerId: bets.playerId,
                    settled: count(decided),
                    won: count(sql`${bets.status} = 'won'`),
                    void: count(sql`${bets.status} = 'void'`),
                    open: count(sql`${bets.status} = 'open'`),
                    stakedOre: sum(sql`${bets.stakeOre}`, decided),
                    profitOre: sum(sql`${bets.profitOre}`, sql`${bets.status} <> 'open'`),
                    openStakeOre: sum(sql`${bets.stakeOre}`, sql`${bets.status} = 'open'`),
                    clvSum: sum(sql`${bets.clv}`, sql`${bets.clv} is not null`),
                    clvCount: count(sql`${bets.clv} is not null`),
                })
                .from(bets)
                .where(options.settledSince && gte(bets.settledAt, options.settledSince))
                .groupBy(bets.playerId);
            return new Map(rows.map(({ playerId, ...totals }) => [playerId, totals]));
        },
        /** Whether the player already has any bet on the fixture. */
        async hasBet(playerId: string, fixtureId: string): Promise<boolean> {
            const rows = await db
                .select({ id: bets.id })
                .from(bets)
                .where(and(eq(bets.playerId, playerId), eq(bets.fixtureId, fixtureId)))
                .limit(1);
            return rows.length > 0;
        },
        /** Settled bets in settlement order, with only what a bankroll chart needs. */
        settledLedger(
            playerId: string,
        ): Promise<Pick<Bet, "status" | "stakeOre" | "profitOre" | "settledAt" | "clv">[]> {
            return db
                .select({
                    status: bets.status,
                    stakeOre: bets.stakeOre,
                    profitOre: bets.profitOre,
                    settledAt: bets.settledAt,
                    clv: bets.clv,
                })
                .from(bets)
                .where(and(eq(bets.playerId, playerId), sql`${bets.status} <> 'open'`))
                .orderBy(bets.settledAt);
        },
        forPlayer(playerId: string): Promise<Bet[]> {
            return db.select().from(bets).where(eq(bets.playerId, playerId)).orderBy(bets.createdAt);
        },
        /** Marks a tip's price as gone; false when it was already marked, so two polls cannot both alert. */
        async markPriceGone(id: string, at: Date): Promise<boolean> {
            const rows = await db
                .update(bets)
                .set({ priceGoneAt: at })
                .where(and(eq(bets.id, id), isNull(bets.priceGoneAt)))
                .returning({ id: bets.id });
            return rows.length > 0;
        },
        /** Records closing odds and CLV; `provisional` marks values a better closing source may replace later. */
        async setClosing(id: string, closing: { fairOdds: number; clv: number; provisional: boolean }): Promise<void> {
            await db
                .update(bets)
                .set({
                    closingFairOdds: closing.fairOdds,
                    clv: closing.clv,
                    closingProvisional: closing.provisional,
                })
                .where(eq(bets.id, id));
        },
        /**
         * A player's match-result bets placed since `since`, each with the prices its bookmaker showed for the same
         * selection in later polls, oldest bet first. For the scanner these are its tips.
         */
        async withLaterPrices(playerId: string, since: Date): Promise<{ bet: Bet; later: LaterPrice[] }[]> {
            const placed = await db
                .select()
                .from(bets)
                .where(
                    and(
                        eq(bets.playerId, playerId),
                        eq(bets.market, "h2h"),
                        isNotNull(bets.fixtureId),
                        gte(bets.createdAt, since),
                    ),
                )
                .orderBy(bets.createdAt);
            const fixtureIds = [...new Set(placed.flatMap((bet) => (bet.fixtureId ? [bet.fixtureId] : [])))];
            if (fixtureIds.length === 0) return [];
            const snapshots = await db
                .select({
                    fixtureId: oddsSnapshots.fixtureId,
                    bookmaker: oddsSnapshots.bookmaker,
                    selection: oddsSnapshots.selection,
                    price: oddsSnapshots.price,
                    takenAt: oddsSnapshots.takenAt,
                    kind: oddsSnapshots.kind,
                })
                .from(oddsSnapshots)
                .where(
                    and(
                        inArray(oddsSnapshots.fixtureId, fixtureIds),
                        eq(oddsSnapshots.market, "h2h"),
                        gt(oddsSnapshots.takenAt, since),
                    ),
                );
            return placed.map((bet) => ({
                bet,
                later: snapshots.filter(
                    (seen) =>
                        seen.fixtureId === bet.fixtureId &&
                        seen.bookmaker === bet.bookmaker &&
                        seen.selection === bet.selection &&
                        seen.takenAt > bet.createdAt,
                ),
            }));
        },
        /** A player's settled bets on tracked fixtures, with the fixture's league and kickoff, for breakdowns. */
        async settledWithFixture(playerId: string): Promise<(Bet & { league: string; kickoff: Date })[]> {
            const rows = await db
                .select({ bet: bets, league: fixtures.league, kickoff: fixtures.kickoff })
                .from(bets)
                .innerJoin(fixtures, eq(bets.fixtureId, fixtures.id))
                .where(and(eq(bets.playerId, playerId), sql`${bets.status} <> 'open'`))
                .orderBy(bets.settledAt);
            return rows.map(({ bet, ...fixture }) => ({ ...bet, ...fixture }));
        },
        /** Deletes a bet the player logged themselves, while it is open; false when there is no such bet. */
        async removeOwnOpen(id: string, playerId: string): Promise<boolean> {
            const rows = await db
                .delete(bets)
                .where(
                    and(
                        eq(bets.id, id),
                        eq(bets.playerId, playerId),
                        eq(bets.status, "open"),
                        eq(bets.selfReported, true),
                    ),
                )
                .returning({ id: bets.id });
            return rows.length > 0;
        },
        async get(id: string): Promise<Bet | undefined> {
            const [row] = await db.select().from(bets).where(eq(bets.id, id));
            return row;
        },
        openFor(playerId: string): Promise<Bet[]> {
            return db
                .select()
                .from(bets)
                .where(and(eq(bets.playerId, playerId), eq(bets.status, "open")))
                .orderBy(bets.createdAt);
        },
        /** For a cashed-out bet: how the selection itself ended. */
        async setHeldStatus(id: string, heldStatus: "won" | "lost" | "void"): Promise<void> {
            await db
                .update(bets)
                .set({ heldStatus })
                .where(and(eq(bets.id, id), eq(bets.status, "cashed_out")));
        },
        /**
         * Settles an open bet once; false when it was already settled. A cash-out also records the offer and the
         * price it implies; its price move comes from `impliedCurrentOdds`, not `clv`.
         */
        async settle(id: string, settlement: Settlement): Promise<boolean> {
            const rows = await db
                .update(bets)
                .set(settlement)
                .where(and(eq(bets.id, id), eq(bets.status, "open")))
                .returning({ id: bets.id });
            return rows.length > 0;
        },
    };
}
