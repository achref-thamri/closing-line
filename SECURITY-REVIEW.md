# Closing Line Production Review

Review date: 2026-11-22

## Overall Verdict

The implementation is generally well-structured, typed, and test-driven. The monorepo boundaries, database constraints, retry logic, scheduler job claiming, and Telegram authorization ownership checks are sound engineering choices.

The code is not fully production-ready yet: settlement currently has a partial-failure path that can permanently leave open bets on a match whose fixture is already marked settled, and the read-only SSH access path allows `psql` meta-command escapes.

## Security Summary

| #   | Severity  | File                                | Lines | Vulnerability                                               | Confidence |
| --- | --------- | ----------------------------------- | ----- | ----------------------------------------------------------- | ---------- |
| 1   | 🟡 MEDIUM | scripts/read-access/server-setup.sh | 32-68 | `psql` meta-command escape from the read-only SSH interface | 9/10       |

### 1. Read-only SQL boundary can escape PostgreSQL restrictions

- **Location:** `scripts/read-access/server-setup.sh:32-68`
- **Explanation:** `~/bin/db-read` launches unrestricted `psql -U reader` and forwards SSH stdin. The database role is read-only and statements have a 30-second timeout, but `psql` interprets client-side meta-commands such as `\! command` and `\copy`, which are not constrained by the PostgreSQL role or the forced-command argument allowlist.
- **Impact:** A holder of the read-only SSH key can escape the SQL-only boundary and execute a shell command inside the PostgreSQL container or interact with local files exposed to that container.
- **Severity:** Medium
- **Recommended fix:** Replace `psql` stdin access with a purpose-built read-only API or SQL wrapper that parses and allowlists `SELECT`/`WITH` statements and rejects meta-commands. Keep the PostgreSQL read-only role as defense in depth.

## Critical and High-Priority Findings

### 1. Fixture and bet settlement are not atomic

- **Location:** `apps/worker/src/app/settleBets.ts:95-99`, `apps/worker/src/app/settleBets.ts:160-172`, `apps/worker/src/app/settleBets.ts:175-193`
- **Explanation:** `recordFinished` marks a fixture as `finished` before `settleFixtureBets` settles the fixture's open bets. The void path has the same ordering: the fixture is marked `void` before individual bets are settled.
- **Impact:** If the process crashes or a database operation fails after the fixture update but while the bet loop is in progress, the remaining open bets can never be reconsidered because future settlement queries only include fixtures with `scheduled` status.
- **Severity:** High
- **Recommended fix:** Perform fixture-result and all h2h bet settlements in one database transaction, or make the repository retry invariant explicit: settle each open bet first and only mark the fixture terminal after every bet has been settled. Add a fault-injection test covering a failure in the middle of the loop.

## Reliability Findings

### 1. Telegram-entered stakes can exceed the database integer range

- **Location:** `apps/worker/src/app/format.ts:44-60`, `apps/worker/src/app/betFlow.ts:193-197`, `apps/worker/src/app/betFlow.ts:522-539`, `packages/db/src/schema.ts:119`
- **Explanation:** Stake parsing accepts any positive finite kroner value and converts it to øre. The database column is a 32-bit PostgreSQL integer, but the draft only validates `zod.int()` and has no upper bound.
- **Impact:** A stake above roughly 21.47 million kroner produces a value above PostgreSQL's integer range, causing the bet insert to fail at runtime. The Telegram error path does not provide a reliable user-facing message for this class of failure.
- **Severity:** Medium
- **Recommended fix:** Define and validate an explicit maximum stake in cents/øre before accepting it, and keep the parser, draft schema, and database constraint aligned. Optionally enforce a positive 32-bit-safe range in the database.

## Architecture and Structure

The project is appropriately decomposed into a domain core, database package, configuration package, web app, and worker app. The composition root at `apps/worker/src/compose.ts` is concise and prevents `main.ts` from becoming application logic. Ports/adapters and Zod validation are justified here. Database constraints and repository methods provide meaningful invariants.

No repository-wide architectural blocker was found.

## Redundancy and Cleanup

No significant unused dependencies or justified-simplification candidates were identified. The codebase has a few deliberately defensive compatibility checks, but they match real persisted-state and external-API migration risks.

## Performance and Reliability

- **No confirmed scheduler duplicates:** `jobRuns` keys claim jobs atomically before execution.
- **No major web hot-path issue found:** dashboard totals and leaderboard values are mostly aggregated or limited by the repository.
- **Main settlement risk:** atomicity, as described above.
- **HTTP reliability:** retries, timeouts, response validation, credit handling, and bounded backoff are implemented consistently.

## Testing

The suite is substantial: 50 test files and 346 tests pass. Existing tests cover the settlement happy path, partial league failures, database constraints, Telegram flows, retries, and the dashboard.

Confirmed missing regressions:

- A database or process failure halfway through settling fixture bets is not tested in `apps/worker/src/app/__tests__/settleBets.test.ts`.
- The database integer range and Telegram stake upper bound are not tested in `apps/worker/src/app/__tests__/betFlow.test.ts` or `packages/db/src/__tests__/repositories.test.ts`.
- The read-only SSH forced-command boundary is not covered by an executable test or integration check in `scripts/read-access/`.

## AI-Generated Pattern Assessment

The implementation generally avoids AI-generated boilerplate and generic abstractions. Comments are concentrated around non-obvious domain and operational invariants. Defensive parsing is used at external boundaries and for durable JSON state. No speculative service or repository abstraction was identified.
