# Production Code Audit

Review date: 2026-11-22

## Overall Engineering Quality

This is generally a disciplined, senior-level implementation. The monorepo has clear package boundaries, the worker has a composition root, external integrations use ports/adapters, database writes are protected by Drizzle constraints, and configuration is validated at startup. The team has invested appropriately in testability: HTTP retries, scheduler state, settlement, Telegram flows, database repositories, scanner calculations, and dashboard behavior are covered.

The implementation is close to production-ready. It has no broad architectural rewrite or dependency-cleanup requirement. The remaining issues are concentrated in failure atomicity, retry policy, and two security/reliability boundaries.

## Finding Summary

| #   | Severity  | File                                | Lines                   | Vulnerability                                                                                                      | Confidence |
| --- | --------- | ----------------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------ | ---------- |
| 1   | 🟠 HIGH   | apps/worker/src/app/settleBets.ts   | 95-99, 160-172, 175-193 | Fixture is marked terminal before its bets are settled, allowing permanent loss of open bets after partial failure | 9/10       |
| 2   | 🟡 MEDIUM | scripts/read-access/server-setup.sh | 32-68                   | Read-only SSH SQL access exposes `psql` meta-command escapes                                                       | 9/10       |
| 3   | 🟡 MEDIUM | apps/worker/src/app/betFlow.ts      | 193-197, 522-539        | Stake input has no PostgreSQL integer-range boundary                                                               | 8/10       |
| 4   | 🟡 MEDIUM | apps/worker/src/scheduler/runner.ts | 44-48                   | Failed scheduled jobs are recorded and explicitly never retried within their key/window                            | 8/10       |
| 5   | 🟡 MEDIUM | docker-compose.yml                  | 1-80                    | Database and backups remain on the same host/volume, with no off-host restore copy                                 | 7/10       |

## Critical and High-Priority Issues

### 1. Settlement is not atomic

**File:** `apps/worker/src/app/settleBets.ts:95-99`, `apps/worker/src/app/settleBets.ts:160-172`, `apps/worker/src/app/settleBets.ts:175-193`

**Severity:** High

**Impact:** `recordFinished` updates the fixture to `finished` or the caller updates it to `void` before `settleFixtureBets` updates each open bet. A process crash or database failure after the fixture update but before the bet loop completes leaves the fixture terminal and all remaining bets open. Future jobs select only `scheduled` fixtures, so those bets are not reconsidered.

**Recommended fix:** Execute the fixture update and every affected bet settlement inside one database transaction. At minimum, add a repository operation that settles each bet and flips the fixture status atomically. Add a fault-injection test that fails midway through a fixture's bet loop and prove rollback/recovery.

## Security Vulnerabilities and Risks

### 1. Read-only SSH access can escape its SQL boundary

**File:** `scripts/read-access/server-setup.sh:32-68`

**Severity:** Medium

**Impact:** `~/bin/db-read` launches unrestricted `psql -U reader` and forwards stdin. PostgreSQL transaction/read-only settings constrain SQL, but `psql` accepts client-side meta-commands such as `\! command` and `\copy`. The read-only role and 30-second statement timeout do not contain those operations.

**Recommended fix:** Replace interactive `psql` stdin access with a purpose-built constrained query service or a parser that accepts only `SELECT`/`WITH` statements and rejects meta-commands. Retain the database role as defense in depth. Test the boundary by attempting shell escape and file read/write meta-commands.

No confirmed application authentication or authorization vulnerability was found. Telegram access is owner-scoped or approval-scoped through player records, and destructive bet callbacks verify ownership through `ownBet` or `removeOwnOpen`.

## Reliability and Failure Scenarios

### 1. Failed scheduled jobs are not retried

**File:** `apps/worker/src/scheduler/runner.ts:44-48`, `apps/worker/src/scheduler/__tests__/runner.test.ts:93-103`

**Severity:** Medium

**Impact:** A claimed job is marked `failed`; subsequent ticks exclude the key, and the key's window is not revisited. This can miss a poll or report when an external dependency fails after its HTTP retries. This behavior is deliberate, but it does not distinguish duplicate prevention from transient failure recovery.

**Recommended fix:** Keep duplicate prevention for succeeded/running work, but allow bounded retries for failed jobs or assign a retry key while preserving at-most-once completion. A crash-safe claim plus idempotent handlers is a cleaner model. Preserve stale-job skipping and expose retry count in job history.

### 2. Stakes can overflow PostgreSQL integers

**File:** `apps/worker/src/app/format.ts:44-60`, `apps/worker/src/app/betFlow.ts:193-197`, `apps/worker/src/app/betFlow.ts:522-539`, `packages/db/src/schema.ts:119`

**Severity:** Medium

**Impact:** `parseKroner` accepts any positive finite amount, and `toOre` converts it to øre. PostgreSQL integer columns reject values above 2,147,483,647 øre, so roughly 21.48 million kroner is not a valid stake despite being accepted by the Telegram flow.

**Recommended fix:** Establish one exported stake range with a maximum safely below the integer limit, validate it in `parseKroner` or draft completion, and optionally add a database check constraint for `stakeOre`.

### 3. Local-only backup storage

**File:** `docker-compose.yml:1-80`, `docker/backup.sh:1-24`

**Severity:** Medium

**Impact:** PostgreSQL data and compressed backups are Docker host volumes on the same server. A host disk failure or complete server loss can destroy both the live database and restore copies.

**Recommended fix:** Copy nightly backups off-host and verify restore status from the remote copy. Preserve the existing local retention for short recovery, but make off-host retention and restore testing an operational requirement.

## Architecture and Structure

### Assessment

The architecture is maintainable and appropriately simple:

- `packages/core` owns domain rules and pure calculations.
- `packages/db` owns schema, migrations, constraints, and repository operations.
- `packages/config` owns startup environment/settings validation.
- `apps/worker` separates composition, ports/adapters, application flows, and scheduling.
- `apps/web` is read-only and uses the repository package to load dashboard data.

The composition root in `apps/worker/src/compose.ts` wires integrations once and keeps `main.ts` focused on startup/shutdown. The port/adapters split is justified for external APIs and test doubles. The Telegram and scheduler domains are not hidden behind unnecessary framework abstractions.

No repository-wide architectural blocker was found.

## Code Quality

The implementation is clean and consistent. TypeScript strictness, Zod boundaries, explicit domain types, database constraints, and repository return types are used effectively. Error handling is purposeful, especially in HTTP parsing/retry logic and Telegram polling. Comments explain real invariants rather than restating obvious code.

No `as any`, broad silent fallbacks, speculative abstractions, or significant unused-code findings were found.

## Performance

- Paid Odds API calls are guarded, credited, bounded, and recorded.
- Scheduler ticks do not overlap.
- Dashboard aggregates player totals and limited bet listings through SQL.
- The odds snapshot table is explicitly indexed and bounded by query intent.
- HTTP calls have 15-second timeouts and bounded retry backoff.

No major query bottleneck or memory leak was confirmed. The main performance/reliability concerns are failure atomicity and recovery policy rather than routine hot-path operations.

## Testing

The suite passes under the current repository checks:

- 50 test files
- 346 tests
- Statement coverage: 97.69%
- Branch coverage: 91.25%
- Function coverage: 96.46%
- Line coverage: 98.49%
- Typecheck, lint, and Knip pass

Tests exercise real behavior and database constraints, including PGlite and PostgreSQL CI coverage. The strongest gap is not test quantity but recovery invariants:

1. Fault injection between fixture update and individual bet settlement.
2. Telegram stake values at or beyond the database integer boundary.
3. Failed-job retry or bounded requeue policy.
4. Read-only SSH meta-command and file escape attempts.
5. Real backup restore performed from an off-host copy.

## AI-Generated Pattern Assessment

The code generally does not exhibit excessive AI boilerplate. Validation, adapter separation, comments, and defensive parsing solve real persisted-state or external-data problems. No speculative framework or abstraction was identified that should be removed wholesale.

## Final Production-Readiness Verdict

**Verdict: Nearly production-ready, with one High-priority fix before release.**

The architecture, configuration, domain logic, database design, test suite, and operational tooling are strong. The release blocker is settlement atomicity: a partial database/process failure must not leave a terminal fixture with open bets. After atomic settlement and a bounded retry policy are addressed, the read-only SSH boundary and stake range should be hardened before exposure.
