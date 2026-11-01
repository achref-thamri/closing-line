export function kroner(ore: number): string {
    return `${Math.round(ore / 100).toLocaleString("en-GB")} kr`;
}

export function signedKroner(ore: number): string {
    return `${ore > 0 ? "+" : ore < 0 ? "−" : ""}${kroner(Math.abs(ore))}`;
}

export function percent(value: number | undefined): string {
    if (value === undefined) return "–";
    return `${value > 0 ? "+" : value < 0 ? "−" : ""}${Math.abs(value * 100).toFixed(1)}%`;
}

export function odds(value: number): string {
    return value.toFixed(2);
}

export function shortDate(date: Date, timeZone = "Europe/Copenhagen"): string {
    return date.toLocaleString("en-GB", {
        timeZone,
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
    });
}
