export type JobKind = "sync" | "morning_poll" | "prekickoff_poll" | "settle" | "weekly_report";

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
/**
 * The pre-kickoff poll gives the closing price (ADR 0006), so it runs as late as is safe: from 15 minutes before
 * kickoff, after team news is priced in, until 2 minutes before; never later.
 */
const PREKICKOFF_OPENS_MIN = 15;
const PREKICKOFF_CLOSES_MIN = 2;
const SETTLE_FROM_MINUTE = 15;
const REPORT_HOUR = 8;

/**
 * The jobs due at `now`. Each job has a window and runs once inside it; a window that passed while the worker
 * was down is skipped, never replayed late (stale odds would place bets on prices that no longer exist).
 * - `sync`: daily from 06:00 local (free fixture sync).
 * - `settle`: hourly from minute 15 (free; does nothing when no match is due).
 * - `morning_poll`: 09:00–12:00 local, per league with a match still to come that day.
 * - `prekickoff_poll`: per league and kickoff time, 15 to 2 minutes before kickoff.
 * - `weekly_report`: Mondays from 08:00 local.
 */
export function dueJobs(input: PlanInput): PlannedJob[] {
    const { now, timeZone } = input;
    const local = localTime(now, timeZone);
    const jobs: PlannedJob[] = [];

    if (local.hour >= SYNC_FROM_HOUR) jobs.push({ key: `sync:${local.date}`, kind: "sync" });
    if (local.minute >= SETTLE_FROM_MINUTE) {
        jobs.push({ key: `settle:${local.date}T${String(local.hour).padStart(2, "0")}`, kind: "settle" });
    }

    if (local.weekday === 1 && local.hour >= REPORT_HOUR)
        jobs.push({ key: `weekly:${local.date}`, kind: "weekly_report" });

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

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Calendar date (YYYY-MM-DD), weekday (0 = Sunday), hour and minute of `date` in `timeZone`. */
/** The instant a wall-clock time (`YYYY-MM-DDTHH:mm`) names in a time zone; undefined when malformed. */
export function zonedTimeToUtc(local: string, timeZone: string): Date | undefined {
    const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local);
    if (!match) return undefined;
    const [year, month, day, hour, minute] = match.slice(1).map(Number) as [number, number, number, number, number];
    const wall = Date.UTC(year, month - 1, day, hour, minute);
    // Correct twice: the zone's offset at the first guess can differ from the answer's around a DST change.
    let guess = wall;
    for (let i = 0; i < 2; i++) guess = wall - offsetMs(new Date(guess), timeZone);
    return new Date(guess);
}

function offsetMs(date: Date, timeZone: string): number {
    const local = localTime(date, timeZone);
    const [year, month, day] = local.date.split("-").map(Number) as [number, number, number];
    const asUtc = Date.UTC(year, month - 1, day, local.hour, local.minute);
    return asUtc - Math.floor(date.getTime() / 60_000) * 60_000;
}

export function localTime(
    date: Date,
    timeZone: string,
): { date: string; weekday: number; hour: number; minute: number } {
    const parts = Object.fromEntries(
        new Intl.DateTimeFormat("en-CA", {
            timeZone,
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
            weekday: "short",
            hourCycle: "h23",
        })
            .formatToParts(date)
            .map((part) => [part.type, part.value]),
    );
    return {
        date: `${parts.year}-${parts.month}-${parts.day}`,
        weekday: WEEKDAYS.indexOf(parts.weekday ?? ""),
        hour: Number(parts.hour),
        minute: Number(parts.minute),
    };
}
