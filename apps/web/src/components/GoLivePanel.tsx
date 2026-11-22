import { GO_LIVE, type GoLiveCheck, type GoLiveItem } from "@closing-line/core";
import { percent, share } from "../lib/format.ts";

/** What each go-live rule needs, and where the scanner stands on it. */
function describe(item: GoLiveItem, check: GoLiveCheck, now: Date): { rule: string; status: string } {
    switch (item.key) {
        case "bets":
            return { rule: `${GO_LIVE.bets} settled bets`, status: `${check.settled} so far` };
        case "months": {
            const days = check.firstBetAt ? Math.floor((now.getTime() - check.firstBetAt.getTime()) / 86_400_000) : 0;
            return { rule: `${GO_LIVE.months} months of bets`, status: `${days} days so far` };
        }
        case "clv": {
            const clv = check.clv;
            const range =
                clv?.low === undefined || clv.high === undefined
                    ? ""
                    : ` (95% range ${percent(clv.low)} to ${percent(clv.high)})`;
            return {
                rule: "Positive average CLV",
                status: clv ? `${percent(clv.mean)} over ${clv.count}${range}` : "no closing prices yet",
            };
        }
        case "benchmark":
            return {
                rule: "ROI above the favourite benchmark",
                status: `${percent(check.roi)} against ${percent(check.benchmarkRoi)}`,
            };
        case "drawdown":
            return {
                rule: `Drawdown under ${GO_LIVE.maxDrawdown * 100}% of the start`,
                status: `worst so far ${share(check.maxDrawdown)}`,
            };
    }
}

/**
 * Rules whose tick means little on a small sample. The CLV rule shows its own 95% range, so it needs no warning.
 */
const EARLY_ITEMS = new Set<GoLiveItem["key"]>(["benchmark", "drawdown"]);

/**
 * The scanner against the go-live rule, from bets today's rules would place. The last rule, no unexplained bugs
 * lately (`GO_LIVE.bugFreeDays`), is checked by hand.
 */
export function GoLivePanel({ check, now = new Date() }: { check: GoLiveCheck; now?: Date }) {
    const early = check.settled < GO_LIVE.bets;
    return (
        <section
            className="rounded-xl border border-zinc-200 p-5 dark:border-zinc-800"
            aria-label="Go-live check"
            data-testid="go-live"
        >
            <header className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="font-semibold">Ready for real money?</h2>
                <span
                    className={`text-sm font-medium ${check.ready ? "text-emerald-600 dark:text-emerald-400" : "text-zinc-500"}`}
                >
                    {check.ready
                        ? `Yes, if there were no unexplained bugs in the last ${GO_LIVE.bugFreeDays} days`
                        : "Not yet"}
                </span>
            </header>
            <p className="mt-1 text-xs text-zinc-500">
                The value scanner, counting only bets today&apos;s rules would place.
            </p>
            <ul className="mt-3 space-y-1.5 text-sm">
                {check.items.map((item) => {
                    const { rule, status } = describe(item, check, now);
                    return (
                        <li key={item.key} className="flex gap-2" data-testid="go-live-item">
                            <span className="shrink-0">
                                <span aria-hidden="true">{item.passed ? "✅" : "⬜"}</span>
                                <span className="sr-only">{item.passed ? "Met:" : "Not met:"}</span>
                            </span>
                            <span>
                                <span className="mr-2 font-medium">{rule}</span>
                                <span className="text-zinc-500 tabular-nums">
                                    {status}
                                    {item.passed && early && EARLY_ITEMS.has(item.key) && (
                                        <span className="ml-1 text-amber-700 dark:text-amber-400">
                                            · early, {check.settled} of {GO_LIVE.bets} bets
                                        </span>
                                    )}
                                </span>
                            </span>
                        </li>
                    );
                })}
            </ul>
        </section>
    );
}
