import { and, desc, eq, gte, lt, sql } from "drizzle-orm";
import { betRepository } from "./bets.ts";
import type { Database } from "./client.ts";
import { apiUsage, chatSessions, decisions, fixtures, jobRuns, oddsSnapshots, players, workerState } from "./schema.ts";

export type Player = typeof players.$inferSelect;
export type NewPlayer = typeof players.$inferInsert;
export type Fixture = typeof fixtures.$inferSelect;
export type NewFixture = Pick<typeof fixtures.$inferInsert, "id" | "league" | "homeTeam" | "awayTeam" | "kickoff">;
export type OddsSnapshot = typeof oddsSnapshots.$inferSelect;
export type NewOddsSnapshot = Omit<typeof oddsSnapshots.$inferInsert, "id">;
export type ApiUsage = typeof apiUsage.$inferSelect;
export type NewApiUsage = Omit<typeof apiUsage.$inferInsert, "id">;
export type JobRun = typeof jobRuns.$inferSelect;
export type NewDecision = Omit<typeof decisions.$inferInsert, "id">;
export type Decision = typeof decisions.$inferSelect;
/** A decision with its match's league and how it ended: null goals until it is settled. */
export type DecisionWithResult = Decision & {
    league: string;
    status: Fixture["status"];
    homeGoals: number | null;
    awayGoals: number | null;
};
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

        bets: betRepository(db),

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

        decisions: {
            async insert(rows: NewDecision[]): Promise<void> {
                if (rows.length === 0) return;
                await db.insert(decisions).values(rows);
            },
            /** Decisions taken at or after `since`, oldest first, with their match's league and result. */
            async since(since: Date): Promise<DecisionWithResult[]> {
                const rows = await db
                    .select({
                        decision: decisions,
                        league: fixtures.league,
                        status: fixtures.status,
                        homeGoals: fixtures.homeGoals,
                        awayGoals: fixtures.awayGoals,
                    })
                    .from(decisions)
                    .innerJoin(fixtures, eq(decisions.fixtureId, fixtures.id))
                    .where(gte(decisions.takenAt, since))
                    .orderBy(decisions.takenAt, decisions.id);
                return rows.map(({ decision, ...match }) => ({ ...decision, ...match }));
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
            async record(row: NewApiUsage): Promise<void> {
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
