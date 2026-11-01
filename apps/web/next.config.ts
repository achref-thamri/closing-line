import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

const config: NextConfig = {
    // Standalone output traces dependencies from the monorepo root, for a small Docker image.
    output: "standalone",
    outputFileTracingRoot: fileURLToPath(new URL("../..", import.meta.url)),
    // Workspace packages ship TypeScript sources.
    transpilePackages: ["@betting/core", "@betting/db"],
    // Database drivers load native or WebAssembly files at runtime; keep them out of the bundle.
    serverExternalPackages: ["@electric-sql/pglite", "postgres"],
    poweredByHeader: false,
};

export default config;
