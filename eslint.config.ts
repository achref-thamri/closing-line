import js from "@eslint/js";
import nextPlugin from "@next/eslint-plugin-next";
import { defineConfig, globalIgnores } from "eslint/config";
import tseslint from "typescript-eslint";

export default defineConfig(
    globalIgnores([
        "**/dist",
        "coverage",
        "**/.turbo",
        "**/.next",
        "**/next-env.d.ts",
        "**/playwright-report",
        "**/test-results",
    ]),
    js.configs.recommended,
    tseslint.configs.strictTypeChecked,
    tseslint.configs.stylisticTypeChecked,
    {
        languageOptions: {
            parserOptions: {
                projectService: true,
                tsconfigRootDir: import.meta.dirname,
            },
        },
        rules: {
            "@typescript-eslint/consistent-type-imports": "error",
            "@typescript-eslint/switch-exhaustiveness-check": "error",
            "@typescript-eslint/restrict-template-expressions": ["error", { allowNumber: true }],
            "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", ignoreRestSiblings: true }],
        },
    },
    // Plain JavaScript config files (PostCSS) have no TypeScript project.
    { files: ["**/*.mjs"], extends: [tseslint.configs.disableTypeChecked] },
    {
        files: ["apps/web/**/*.{ts,tsx}"],
        plugins: { "@next/next": nextPlugin },
        rules: { ...nextPlugin.configs.recommended.rules, ...nextPlugin.configs["core-web-vitals"].rules },
    },
);
