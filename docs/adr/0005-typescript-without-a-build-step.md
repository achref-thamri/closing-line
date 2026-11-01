# 5. Run TypeScript without a build step

Date: 2026-11-01. Status: accepted.

## Context

Node 24 strips TypeScript types natively. A build step adds output folders, source maps and the risk that what runs
is not what was tested.

## Decision

All code uses erasable syntax only (`erasableSyntaxOnly`: no enums, namespaces or parameter properties) and imports
`.ts` files by their real names. `tsc` only type-checks. Workspace packages export their `src/index.ts`. The Docker
image installs production dependencies in the workspace layout and runs `node apps/worker/src/main.ts`.

## Consequences

- No `dist`, no build cache, and stack traces point at the real source lines.
- Node does not strip types inside `node_modules`; workspace packages are symlinks that resolve outside it, so the
  pnpm workspace layout must be kept in the image (`pnpm deploy` copies would break it).
- A future web app (Next.js) will have its own build; this decision covers the worker and the packages.
