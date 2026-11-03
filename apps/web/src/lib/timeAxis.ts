const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
/** Tick steps from fine to coarse; the finest that keeps the axis within `maxTicks` wins. */
const STEPS_MS = [
    HOUR_MS,
    3 * HOUR_MS,
    6 * HOUR_MS,
    12 * HOUR_MS,
    DAY_MS,
    2 * DAY_MS,
    7 * DAY_MS,
    14 * DAY_MS,
    28 * DAY_MS,
];

export interface TimeAxis {
    ticks: number[];
    /** Hours and the day for steps under a day ("2 Nov 18:00"), the day alone otherwise ("2 Nov"). */
    label: (t: number) => string;
}

/**
 * Ticks on round local times (every 6 hours, every day, …) between `from` and `to`, at most `maxTicks` of them, with
 * a label that suits the step, so a chart covering two days does not print the same date four times.
 */
export function timeAxis(from: number, to: number, timeZone: string, maxTicks = 7): TimeAxis {
    const span = to - from;
    const step =
        STEPS_MS.find((candidate) => span / candidate <= maxTicks - 1) ?? STEPS_MS[STEPS_MS.length - 1] ?? DAY_MS;
    const withTime = step < DAY_MS;
    const label = (t: number) =>
        new Date(t).toLocaleString("en-GB", {
            timeZone,
            day: "numeric",
            month: "short",
            ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}),
        });
    if (!Number.isFinite(span) || span <= 0) return { ticks: [], label };

    // Round to the step in local time, so ticks fall on 00:00, 06:00, … where the reader is.
    const offset = offsetMs(from, timeZone);
    const first = Math.ceil((from + offset) / step) * step - offset;
    const ticks: number[] = [];
    for (let t = first; t <= to; t += step) ticks.push(t);
    return { ticks, label };
}

/** How far the time zone's wall clock is ahead of UTC at `t`, e.g. one hour for Copenhagen in winter. */
function offsetMs(t: number, timeZone: string): number {
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
            .formatToParts(new Date(t))
            .map((part) => [part.type, part.value]),
    );
    const wall = Date.UTC(
        Number(parts.year),
        Number(parts.month) - 1,
        Number(parts.day),
        Number(parts.hour),
        Number(parts.minute),
    );
    return wall - Math.floor(t / 60_000) * 60_000;
}
