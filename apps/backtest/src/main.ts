import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { defaultSettings } from "@closing-line/config";
import { parseSeason, type PastMatch } from "./seasons.ts";
import { backtest } from "./simulate.ts";

// Usage: pnpm --filter @closing-line/backtest backtest <season.csv>... [--edges 0.02,0.03,0.04]
const args = process.argv.slice(2);
const edgesFlag = args.indexOf("--edges");
const edges = edgesFlag >= 0 ? (args[edgesFlag + 1] ?? "").split(",").map(Number) : [0.02, 0.03, 0.04, 0.05];
const files = args.filter((arg, i) => !arg.startsWith("--") && (edgesFlag < 0 || i !== edgesFlag + 1));
if (files.length === 0) {
    console.error("Pass one or more football-data.co.uk season CSVs (https://football-data.co.uk/data.php).");
    process.exit(1);
}

// The live scanner's stake rules and bankroll, read from the same defaults the worker uses.
const settings = defaultSettings();
const options = { startingBankroll: settings.startingBankroll, stake: settings.scanner.stake };
const pct = (value: number | undefined) => (value === undefined ? "–" : `${(value * 100).toFixed(1)}%`);

function table(title: string, matches: PastMatch[]): void {
    console.log(`\n${title}: ${matches.length} matches with Pinnacle prices`);
    console.log("edge   bets   won    ROI     avg CLV  beat close  max DD   bankroll");
    for (const minEdge of edges) {
        const r = backtest(matches, { ...options, minEdge });
        console.log(
            [
                pct(minEdge).padEnd(6),
                String(r.bets).padStart(4),
                String(r.won).padStart(5),
                pct(r.roi).padStart(7),
                pct(r.averageClv).padStart(9),
                pct(r.beatClosing).padStart(11),
                pct(r.maxDrawdown).padStart(7),
                Math.round(r.finalBankroll).toLocaleString("en-GB").padStart(10),
            ].join(" "),
        );
    }
}

const all: PastMatch[] = [];
for (const file of files) {
    const matches = parseSeason(readFileSync(file, "latin1"));
    all.push(...matches);
    table(basename(file), matches);
}
// All files in a row on one bankroll: the sample that says most about a threshold.
if (files.length > 1) table("All files", all);
