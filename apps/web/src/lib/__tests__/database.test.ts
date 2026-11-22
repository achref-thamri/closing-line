import type * as db from "@closing-line/db";
import { afterEach, describe, expect, it, vi } from "vitest";

// The first open fails, as when Postgres is still starting; later ones use the real PGlite path.
vi.mock("@closing-line/db", async (importOriginal) => {
    const actual = await importOriginal<typeof db>();
    return {
        ...actual,
        openDatabase: vi.fn(actual.openDatabase).mockRejectedValueOnce(new Error("connection refused")),
    };
});

const { loadDashboard } = await import("../data.ts");

describe("loadDashboard", () => {
    afterEach(() => {
        vi.unstubAllEnvs();
    });

    it("tries the database again after a failed open", async () => {
        vi.stubEnv("DATABASE_URL", "");
        await expect(loadDashboard()).rejects.toThrow("connection refused");
        await expect(loadDashboard()).resolves.toMatchObject({ demo: true });
    }, 30_000);
});
