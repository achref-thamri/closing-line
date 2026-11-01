import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
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

// Not `new URL("../migrations", import.meta.url)`: bundlers (the dashboard's Turbopack) treat that as an asset.
const migrationsFolder = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");

/**
 * Opens the database and, unless `migrate` is false, applies pending migrations before anything else touches it.
 * Only the worker migrates; the dashboard opens Postgres without migrating.
 */
export async function openDatabase(
    target: DatabaseTarget,
    options: { migrate?: boolean } = {},
): Promise<DatabaseHandle> {
    const migrate = options.migrate ?? true;
    if (target.kind === "postgres") {
        const client = postgres(target.url, { max: 5, onnotice: () => undefined });
        const db = drizzlePostgres(client, { schema });
        if (migrate) await migratePostgres(db, { migrationsFolder });
        return { db, close: () => client.end() };
    }

    if (target.dir) mkdirSync(target.dir, { recursive: true });
    const client = new PGlite(target.dir);
    const db = drizzlePglite(client, { schema });
    if (migrate) await migratePglite(db, { migrationsFolder });
    return { db, close: () => client.close() };
}
