import type { PlayerTotals } from "@closing-line/core";
import { and, desc, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import type { Database } from "./client.ts";
import { apiUsage, bets, chatSessions, fixtures, jobRuns, oddsSnapshots, players, workerState } from "./schema.ts";

export type Player = typeof players.$inferSelect;
export type NewPlayer = typeof players.$inferInsert;
export type Fixture = typeof fixtures.$inferSelect;
export type NewFixture = Pick<typeof fixtures.$inferInsert, "id" | "league" | "homeTeam" | "awayTeam" | "kickoff">;
export type OddsSnapshot = typeof oddsSnapshots.$inferSelect;
export type NewOddsSnapshot = Omit<typeof oddsSnapshots.$inferInsert, "id">;
export type Bet = typeof bets.$inferSelect;
export type NewBet = Omit<
    typeof bets.$inferInsert,
    "id" | "status" | "closingFairOdds" | "clv" | "profitOre" | "settledAt"
>;
export type ApiUsage = typeof apiUsage.$inferSelect;
/** `fixture` is null for bets on events we do not track, which carry `eventName` instead. */
export type BetWithFixture = Bet & { fixture: Pick<Fixture, "homeTeam" | "awayTeam" | "kickoff" | "league"> | null };
export type JobRun = typeof jobRuns.$inferSelect;
export type ChatSessionKind = (typeof chatSessions.$inferSelect)["kind"];
/** `value` is whatever the flow stored; the flow checks its shape when it reads it back. */
export interface ChatSession {
    value: unknown;
    updatedAt: Date;
}

export type FixtureResult = { status: "finished"; homeGoals: number; awayGoals: number } | { status: "void" };

export function createRepositories(db: Database) {
    return {
        players: {
            /** Creates missing players and leaves existing ones (and their history) untouched. */
            async ensure(rows: NewPlayer[]): Promise<void> {
                if (rows.length === 0) return;
                await db.insert(players).values(rows).onConflictDoNothing();
            },
            list(): Promise<Player[]> {
                return db.select().from(players).orderBy(players.id);
            },
            async setTipsMuted(id: string, tipsMuted: boolean): Promise<void> {
                await db.update(players).set({ tipsMuted }).where(eq(players.id, id));
            },
            async byChat(chatId: number): Promise<Player | undefined> {
                const [row] = await db
                    .select()
                    .from(players)
                    .where(eq(players.telegramChatId, String(chatId)));
                return row;
            },
        },

        fixtures: {
            /** Inserts new fixtures and moves rescheduled ones; settled fixtures keep their result. */
            async upsert(rows: NewFixture[]): Promise<void> {
                if (rows.length === 0) return;
                await db
                    .insert(fixtures)
                    .values(rows)
                    .onConflictDoUpdate({
                        target: fixtures.id,
                        set: {
                            homeTeam: sql`excluded.home_team`,
                            awayTeam: sql`excluded.away_team`,
                            kickoff: sql`excluded.kickoff`,
                            updatedAt: sql`now()`,
                        },
                        setWhere: eq(fixtures.status, "scheduled"),
                    });
            },
            async get(id: string): Promise<Fixture | undefined> {
                const [row] = await db.select().from(fixtures).where(eq(fixtures.id, id));
                return row;
            },
            /** Fixtures kicking off in [from, to), earliest first. */
            between(from: Date, to: Date, status?: Fixture["status"]): Promise<Fixture[]> {
                return db
                    .select()
                    .from(fixtures)
                    .where(
                        and(
                            gte(fixtures.kickoff, from),
                            lt(fixtures.kickoff, to),
                            status && eq(fixtures.status, status),
                        ),
                    )
                    .orderBy(fixtures.kickoff);
            },
            async setResult(id: string, result: FixtureResult): Promise<void> {
                await db
                    .update(fixtures)
                    .set(
                        result.status === "finished"
                            ? { status: "finished", homeGoals: result.homeGoals, awayGoals: result.awayGoals }
                            : { status: "void", homeGoals: null, awayGoals: null },
                    )
                    .where(eq(fixtures.id, id));
            },
        },

        odds: {
            async insert(rows: NewOddsSnapshot[]): Promise<void> {
                if (rows.length === 0) return;
                await db.insert(oddsSnapshots).values(rows);
            },
            /** When the league's odds were last polled, or undefined before the first poll. */
            async lastTakenAt(league: string): Promise<Date | undefined> {
                const [row] = await db
                    .select({
                        takenAt: sql<Date>`max(${oddsSnapshots.takenAt})`.mapWith((value: string) => new Date(value)),
                    })
                    .from(oddsSnapshots)
                    .innerJoin(fixtures, eq(oddsSnapshots.fixtureId, fixtures.id))
                    .where(eq(fixtures.league, league));
                return row?.takenAt && !Number.isNaN(row.takenAt.getTime()) ? row.takenAt : undefined;
            },
            /** The newest price per bookmaker, market and selection for a fixture, optionally only recent ones. */
            latest(fixtureId: string, since?: Date): Promise<OddsSnapshot[]> {
                return db
                    .selectDistinctOn([oddsSnapshots.bookmaker, oddsSnapshots.market, oddsSnapshots.selection])
                    .from(oddsSnapshots)
                    .where(and(eq(oddsSnapshots.fixtureId, fixtureId), since && gte(oddsSnapshots.takenAt, since)))
                    .orderBy(
                        oddsSnapshots.bookmaker,
                        oddsSnapshots.market,
                        oddsSnapshots.selection,
                        desc(oddsSnapshots.takenAt),
                    );
            },
        },

        bets: {
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
            /** Newest first, with the match each bet is on, for listings. */
            async recent(limit: number, playerId?: string): Promise<BetWithFixture[]> {
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
                    .orderBy(desc(bets.createdAt))
                    .limit(limit);
                return rows.map((row) => ({ ...row.bet, fixture: row.fixture }));
            },
            /**
             * Per-player sums computed by Postgres, so bankrolls and reports never load a player's whole history.
             * With `settledSince`, only bets settled at or after it count (open bets are left out).
             */
            async totals(options: { settledSince?: Date } = {}): Promise<Map<string, PlayerTotals>> {
                const decided = sql`${bets.status} in ('won', 'lost', 'cashed_out')`;
                const count = (condition: ReturnType<typeof sql>) =>
                    sql<number>`count(*) filter (where ${condition})`.mapWith(Number);
                const sum = (column: ReturnType<typeof sql>, condition: ReturnType<typeof sql>) =>
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
            /** Records closing odds and CLV; `provisional` marks values a better closing source may replace later. */
            async setClosing(
                id: string,
                closing: { fairOdds: number; clv: number; provisional: boolean },
            ): Promise<void> {
                await db
                    .update(bets)
                    .set({
                        closingFairOdds: closing.fairOdds,
                        clv: closing.clv,
                        closingProvisional: closing.provisional,
                    })
                    .where(eq(bets.id, id));
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
            /**
             * Settles a bettor's open bet once, including a cash-out with the price it implies; false when it was
             * already settled.
             */
            async settleSlip(
                id: string,
                settlement: {
                    status: "won" | "lost" | "void" | "cashed_out";
                    profitOre: number;
                    settledAt: Date;
                    cashoutOfferOre?: number;
                    impliedCurrentOdds?: number;
                    clv?: number;
                },
            ): Promise<boolean> {
                const rows = await db
                    .update(bets)
                    .set(settlement)
                    .where(and(eq(bets.id, id), eq(bets.status, "open")))
                    .returning({ id: bets.id });
                return rows.length > 0;
            },
            /** For a cashed-out bet: how the selection itself ended. */
            async setHeldStatus(id: string, heldStatus: "won" | "lost" | "void"): Promise<void> {
                await db
                    .update(bets)
                    .set({ heldStatus })
                    .where(and(eq(bets.id, id), eq(bets.status, "cashed_out")));
            },
            /** Settles an open bet once; returns false when it was already settled. */
            async settle(
                id: string,
                settlement: { status: "won" | "lost" | "void"; profitOre: number; settledAt: Date },
            ): Promise<boolean> {
                const rows = await db
                    .update(bets)
                    .set(settlement)
                    .where(and(eq(bets.id, id), eq(bets.status, "open")))
                    .returning({ id: bets.id });
                return rows.length > 0;
            },
        },

        state: {
            async get<T>(key: string): Promise<T | undefined> {
                const [row] = await db.select().from(workerState).where(eq(workerState.key, key));
                return row?.value as T | undefined;
            },
            async set(key: string, value: unknown): Promise<void> {
                await db
                    .insert(workerState)
                    .values({ key, value })
                    .onConflictDoUpdate({ target: workerState.key, set: { value, updatedAt: sql`now()` } });
            },
        },

        chats: {
            async get(chatId: number, kind: ChatSessionKind): Promise<ChatSession | undefined> {
                const [row] = await db
                    .select({ value: chatSessions.value, updatedAt: chatSessions.updatedAt })
                    .from(chatSessions)
                    .where(and(eq(chatSessions.chatId, chatId), eq(chatSessions.kind, kind)));
                return row;
            },
            async put(chatId: number, kind: ChatSessionKind, value: unknown, updatedAt: Date): Promise<void> {
                await db
                    .insert(chatSessions)
                    .values({ chatId, kind, value, updatedAt })
                    .onConflictDoUpdate({
                        target: [chatSessions.chatId, chatSessions.kind],
                        set: { value, updatedAt },
                    });
            },
            async remove(chatId: number, kind: ChatSessionKind): Promise<void> {
                await db.delete(chatSessions).where(and(eq(chatSessions.chatId, chatId), eq(chatSessions.kind, kind)));
            },
        },

        runs: {
            /** Claims a job key; false when it already ran (or is running), so each job runs at most once. */
            async start(key: string, job: string, startedAt: Date): Promise<boolean> {
                const rows = await db
                    .insert(jobRuns)
                    .values({ key, job, startedAt })
                    .onConflictDoNothing()
                    .returning({ key: jobRuns.key });
                return rows.length > 0;
            },
            async finish(
                key: string,
                outcome: { status: "succeeded" | "skipped" | "failed"; message?: string | undefined; finishedAt: Date },
            ): Promise<void> {
                await db
                    .update(jobRuns)
                    .set({ status: outcome.status, message: outcome.message ?? null, finishedAt: outcome.finishedAt })
                    .where(eq(jobRuns.key, key));
            },
            /** Keys of runs started at or after `since`, for planning what is still due. */
            async keysSince(since: Date): Promise<string[]> {
                const rows = await db.select({ key: jobRuns.key }).from(jobRuns).where(gte(jobRuns.startedAt, since));
                return rows.map((row) => row.key);
            },
            recent(limit: number): Promise<JobRun[]> {
                return db.select().from(jobRuns).orderBy(desc(jobRuns.startedAt)).limit(limit);
            },
        },

        apiUsage: {
            async record(row: Omit<ApiUsage, "id">): Promise<void> {
                await db.insert(apiUsage).values(row);
            },
            /** The last reading taken before `before`, e.g. the balance when the day began. */
            async latestBefore(provider: string, before: Date): Promise<ApiUsage | undefined> {
                const [row] = await db
                    .select()
                    .from(apiUsage)
                    .where(and(eq(apiUsage.provider, provider), lt(apiUsage.takenAt, before)))
                    .orderBy(desc(apiUsage.takenAt), desc(apiUsage.id))
                    .limit(1);
                return row;
            },
            async latest(provider: string): Promise<ApiUsage | undefined> {
                const [row] = await db
                    .select()
                    .from(apiUsage)
                    .where(eq(apiUsage.provider, provider))
                    .orderBy(desc(apiUsage.takenAt), desc(apiUsage.id))
                    .limit(1);
                return row;
            },
        },
    };
}

export type Repositories = ReturnType<typeof createRepositories>;
