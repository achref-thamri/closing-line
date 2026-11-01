import { dueJobs, type JobKind, type PlannedJob } from "@betting/core";
import type { Repositories } from "@betting/db";
import type { Logger } from "../lib/logger.ts";
import type { Notify } from "../lib/telegram.ts";

const DAY_MS = 86_400_000;
/** Fixtures this far ahead are enough to plan the next day's polls. */
const PLAN_AHEAD_MS = 36 * 3_600_000;

export interface JobOutcome {
    status: "succeeded" | "skipped";
    message?: string;
}

export type JobHandlers = Record<JobKind, (job: PlannedJob) => Promise<JobOutcome>>;

export interface RunnerDeps {
    repos: Pick<Repositories, "runs" | "fixtures">;
    leagues: readonly string[];
    timeZone: string;
    handlers: JobHandlers;
    now: () => Date;
    logger: Logger;
    notify: Notify;
}

/**
 * One scheduler tick: runs every job due now, one after another. A job key is claimed before it runs, so it runs
 * at most once even across restarts; a failure is recorded and reported, and the next job still runs.
 */
export async function tick(deps: RunnerDeps): Promise<void> {
    const now = deps.now();
    const done = new Set(await deps.repos.runs.keysSince(new Date(now.getTime() - 2 * DAY_MS)));
    const fixtures = await deps.repos.fixtures.between(now, new Date(now.getTime() + PLAN_AHEAD_MS), "scheduled");
    const jobs = dueJobs({ now, timeZone: deps.timeZone, leagues: deps.leagues, fixtures, done });

    for (const job of jobs) {
        if (!(await deps.repos.runs.start(job.key, job.kind, deps.now()))) continue;
        deps.logger.info({ job: job.key }, "job started");
        try {
            const outcome = await deps.handlers[job.kind](job);
            await deps.repos.runs.finish(job.key, { ...outcome, finishedAt: deps.now() });
            deps.logger.info({ job: job.key, ...outcome }, "job finished");
        } catch (error) {
            const message = (error as Error).message;
            await deps.repos.runs.finish(job.key, { status: "failed", message, finishedAt: deps.now() });
            deps.logger.error({ job: job.key, error: message }, "job failed");
            await deps.notify(`❌ Job ${job.key} failed: ${message}`);
        }
    }
}
