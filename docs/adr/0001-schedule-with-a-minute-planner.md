# 1. Schedule jobs with a minute planner over the database

Date: 2026-11-01. Status: accepted.

## Context

Most jobs depend on fixtures, not on the clock: an odds poll shortly before each kickoff slot, a morning poll only
on match days. Fixtures move when matches are rescheduled. The worker must never replay a missed poll late, because
odds from after the window would place bets at prices that no longer exist. Tests and local runs use PGlite.

The first plan was pg-boss, a job queue in Postgres with cron schedules and delayed jobs.

## Decision

Every minute the worker asks a pure function, `dueJobs` in `@closing-line/core`, which jobs are due, given the time,
the upcoming fixtures and the keys of jobs that already ran. Each job has a window and a unique key (for example
`prekickoff:soccer_epl:2026-11-08T14:00:00.000Z`). The runner claims the key in `job_runs` with an insert that does
nothing on conflict, runs the job, and records the outcome.

## Consequences

- Rescheduled fixtures need no rescheduling: the next tick plans from the new kickoff.
- Missed windows are skipped by construction; a job runs at most once, even across restarts.
- The whole schedule is a pure function with table-driven tests, including daylight saving time.
- No queue to operate, and it works the same on PGlite and Postgres. pg-boss stays an option if jobs ever need
  to run in parallel across several workers.
