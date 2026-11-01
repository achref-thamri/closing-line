import { and, desc, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import type { Database } from "./client.ts";
import { apiUsage, bets, fixtures, jobRuns, oddsSnapshots, players, workerState } from "./schema.ts";

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
export type BetWithFixture = Bet & { fixture: Pick<Fixture, "homeTeam" | "awayTeam" | "kickoff" | "league"> };
export type JobRun = typeof jobRuns.$inferSelect;

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
                    .innerJoin(fixtures, eq(bets.fixtureId, fixtures.id))
                    .where(playerId ? eq(bets.playerId, playerId) : undefined)
                    .orderBy(desc(bets.createdAt))
                    .limit(limit);
                return rows.map((row) => ({ ...row.bet, fixture: row.fixture }));
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
