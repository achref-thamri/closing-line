export type JobKind = "sync" | "morning_poll" | "prekickoff_poll" | "settle";

export interface PlannedJob {
    /** Unique per run: a job with a key that already ran is never due again. */
    key: string;
    kind: JobKind;
    /** The Odds API sport key, for polls. */
    league?: string;
}

export interface UpcomingFixture {
    league: string;
    kickoff: Date;
}

export interface PlanInput {
    now: Date;
    timeZone: string;
    leagues: readonly string[];
    /** Scheduled fixtures from now on (a day or two ahead is enough). */
    fixtures: readonly UpcomingFixture[];
    /** Keys of jobs that already ran. */
    done: ReadonlySet<string>;
}

const MINUTE_MS = 60_000;
const SYNC_FROM_HOUR = 6;
const MORNING_HOURS = [9, 12] as const;
/** The pre-kickoff poll runs 30 minutes before kickoff, and may start up to 5 minutes before it; never later. */
const PREKICKOFF_OPENS_MIN = 35;
const PREKICKOFF_CLOSES_MIN = 5;
const SETTLE_FROM_MINUTE = 15;

/**
 * The jobs due at `now`. Each job has a window and runs once inside it; a window that passed while the worker
 * was down is skipped, never replayed late (stale odds would place bets on prices that no longer exist).
 * - `sync`: daily from 06:00 local (free fixture sync).
 * - `settle`: hourly from minute 15 (free; does nothing when no match is due).
 * - `morning_poll`: 09:00–12:00 local, per league with a match still to come that day.
 * - `prekickoff_poll`: per league and kickoff time, 35 to 5 minutes before kickoff.
 */
export function dueJobs(input: PlanInput): PlannedJob[] {
    const { now, timeZone } = input;
    const local = localTime(now, timeZone);
    const jobs: PlannedJob[] = [];

    if (local.hour >= SYNC_FROM_HOUR) jobs.push({ key: `sync:${local.date}`, kind: "sync" });
    if (local.minute >= SETTLE_FROM_MINUTE) {
        jobs.push({ key: `settle:${local.date}T${String(local.hour).padStart(2, "0")}`, kind: "settle" });
    }

    if (local.hour >= MORNING_HOURS[0] && local.hour < MORNING_HOURS[1]) {
        for (const league of input.leagues) {
            const matchToday = input.fixtures.some(
                (fixture) =>
                    fixture.league === league &&
                    fixture.kickoff > now &&
                    localTime(fixture.kickoff, timeZone).date === local.date,
            );
            if (matchToday) jobs.push({ key: `morning:${league}:${local.date}`, kind: "morning_poll", league });
        }
    }

    const slots = new Set<string>();
    for (const fixture of input.fixtures) {
        if (!input.leagues.includes(fixture.league)) continue;
        const minutesToKickoff = (fixture.kickoff.getTime() - now.getTime()) / MINUTE_MS;
        if (minutesToKickoff > PREKICKOFF_OPENS_MIN || minutesToKickoff <= PREKICKOFF_CLOSES_MIN) continue;
        const key = `prekickoff:${fixture.league}:${fixture.kickoff.toISOString()}`;
        if (slots.has(key)) continue;
        slots.add(key);
        jobs.push({ key, kind: "prekickoff_poll", league: fixture.league });
    }

    return jobs.filter((job) => !input.done.has(job.key));
}

/** Calendar date (YYYY-MM-DD), hour and minute of `date` in `timeZone`. */
export function localTime(date: Date, timeZone: string): { date: string; hour: number; minute: number } {
    const parts = Object.fromEntries(
        new Intl.DateTimeFormat("en-CA", {
            timeZone,
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
            hourCycle: "h23",
        })
            .formatToParts(date)
            .map((part) => [part.type, part.value]),
    );
    return {
        date: `${parts.year}-${parts.month}-${parts.day}`,
        hour: Number(parts.hour),
        minute: Number(parts.minute),
    };
}
