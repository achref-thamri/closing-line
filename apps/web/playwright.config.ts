import { defineConfig, devices } from "@playwright/test";

const PORT = 3100;

/** Smoke tests against a production build in demo mode (no DATABASE_URL). Run `pnpm build` first. */
export default defineConfig({
    testDir: "e2e",
    testMatch: "**/*.e2e.ts",
    forbidOnly: Boolean(process.env.CI),
    reporter: process.env.CI ? "github" : "list",
    use: { baseURL: `http://localhost:${PORT}`, trace: "retain-on-failure" },
    projects: [
        { name: "desktop", use: { ...devices["Desktop Chrome"] } },
        { name: "phone", use: { ...devices["Pixel 7"] } },
    ],
    webServer: {
        command: `pnpm start --port ${PORT}`,
        url: `http://localhost:${PORT}`,
        reuseExistingServer: !process.env.CI,
        env: { DATABASE_URL: "" },
    },
});
