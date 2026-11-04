import { playerStats } from "@closing-line/core";
import { createRepositories, openDatabase } from "@closing-line/db";
import { describe, expect, it } from "vitest";
import { seedDemo } from "../demo.ts";

describe("seedDemo", () => {
    it("tells the story the dashboard is meant to show", async () => {
        const handle = await openDatabase({ kind: "pglite" });
        const repos = createRepositories(handle.db);
        await seedDemo(repos, new Date("2026-11-01T12:00:00Z"));

        const players = await repos.players.list();
        expect(players.map((player) => player.id)).toEqual(["favourite", "friend", "scanner"]);
        const clv = async (id: string) => playerStats(await repos.bets.forPlayer(id)).averageClv ?? 0;
        // The scanner and the friend beat the closing line on average; backing the favourite does not.
        expect(await clv("scanner")).toBeGreaterThan(0);
        expect(await clv("friend")).toBeGreaterThan(0);
        expect(await clv("favourite")).toBeLessThan(0);
        // Matches still to come keep their bets open; everything before now is settled.
        const favourite = playerStats(await repos.bets.forPlayer("favourite"));
        expect(favourite.settled).toBe(100);
        expect(favourite.open).toBe(10);
        await handle.close();
    }, 30_000); // A PGlite start plus the whole demo seed: over 5 s when the full suite runs in parallel.
});
