import { defineConfig } from "vitest/config";

export default defineConfig({
    test: {
        projects: ["packages/*"],
        coverage: {
            provider: "v8",
            include: ["packages/*/src/**/*.ts"],
            exclude: ["**/__tests__/**"],
            reporter: ["text-summary", "html", "json-summary"],
        },
    },
});
