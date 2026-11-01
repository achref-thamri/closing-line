import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";
import { drizzle as drizzlePostgres } from "drizzle-orm/postgres-js";
import { migrate as migratePostgres } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import * as schema from "./schema.ts";

export type Database = PgDatabase<PgQueryResultHKT, typeof schema>;

export type DatabaseTarget =
    | { kind: "postgres"; url: string }
    /** `dir` omitted means in memory, for tests. */
    | { kind: "pglite"; dir?: string | undefined };

export interface DatabaseHandle {
    db: Database;
    close(): Promise<void>;
}

const migrationsFolder = fileURLToPath(new URL("../migrations", import.meta.url));

/** Opens the database and applies pending migrations before anything else touches it. */
export async function openDatabase(target: DatabaseTarget): Promise<DatabaseHandle> {
    if (target.kind === "postgres") {
        const client = postgres(target.url, { max: 5, onnotice: () => undefined });
        const db = drizzlePostgres(client, { schema });
        await migratePostgres(db, { migrationsFolder });
        return { db, close: () => client.end() };
    }

    if (target.dir) mkdirSync(target.dir, { recursive: true });
    const client = new PGlite(target.dir);
    const db = drizzlePglite(client, { schema });
    await migratePglite(db, { migrationsFolder });
    return { db, close: () => client.close() };
}
