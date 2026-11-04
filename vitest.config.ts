import { defineConfig } from "vitest/config";

export default defineConfig({
    test: {
        projects: ["packages/*", "apps/*"],
        coverage: {
            provider: "v8",
            include: ["packages/*/src/**/*.ts", "apps/*/src/**/*.ts"],
            // Table definitions are declarations (the repository tests exercise them); the main.ts files only start or print;
            // the dashboard is covered by its Playwright tests.
            exclude: [
                "**/__tests__/**",
                "packages/db/src/schema.ts",
                "apps/worker/src/main.ts",
                "apps/backtest/src/main.ts",
                "apps/web/**",
            ],
            reporter: ["text-summary", "html", "json-summary"],
            // The Postgres branch of the database client runs in the separate Postgres CI job.
            thresholds: { statements: 95, branches: 90, functions: 95, lines: 95 },
        },
    },
});
