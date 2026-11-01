import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openDatabase } from "../client.ts";
import { createRepositories } from "../repositories.ts";

describe("openDatabase", () => {
    it("keeps data in a PGlite directory across restarts and migrates only once", async () => {
        const dir = join(mkdtempSync(join(tmpdir(), "pglite-")), "data");
        const player = { id: "scanner", name: "Scanner", kind: "scanner" as const, startingBankrollOre: 1_000_000 };

        const first = await openDatabase({ kind: "pglite", dir });
        await createRepositories(first.db).players.ensure([player]);
        await first.close();

        const second = await openDatabase({ kind: "pglite", dir });
        expect(await createRepositories(second.db).players.list()).toMatchObject([player]);
        await second.close();
    });
});
