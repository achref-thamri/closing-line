import { readFileSync } from "node:fs";
import { checkModel } from "./modelCheck.ts";
import { parseResults, parseSeason, type PastMatch, type SeasonResult } from "./seasons.ts";

// Usage: pnpm --filter @closing-line/backtest model <season.csv>... [--from 2020-08-01] [--half-life 365] [--prior 1]
// Pass both divisions of each country and a season or two before --from, so the model has history from the start.
const args = process.argv.slice(2);
const flag = (name: string, fallback: string) => {
    const index = args.indexOf(name);
    return index >= 0 ? (args[index + 1] ?? fallback) : fallback;
};
const files = args.filter((arg, i) => !arg.startsWith("--") && !args[i - 1]?.startsWith("--"));
if (files.length === 0) {
    console.error("Pass football-data.co.uk season CSVs (https://football-data.co.uk/data.php), both divisions.");
    process.exit(1);
}
const from = new Date(flag("--from", "2020-08-01"));
const options = {
    halfLifeDays: Number(flag("--half-life", "365")),
    prior: Number(flag("--prior", "1")),
    blendWeights: [0, 0.1, 0.2, 0.3, 0.5, 1],
    minEdge: 0.02,
};

const results: SeasonResult[] = [];
const matches: PastMatch[] = [];
for (const file of files) {
    const csv = readFileSync(file, "latin1");
    results.push(...parseResults(csv));
    matches.push(...parseSeason(csv).filter((match) => match.playedAt >= from));
}

const r = checkModel(results, matches, options);
const loss = (value: number) => value.toFixed(4);
const pct = (value: number | undefined) => (value === undefined ? "–" : `${(value * 100).toFixed(1)}%`);

console.log(`Log loss (lower is better), half-life ${options.halfLifeDays} days, prior ${options.prior}`);
console.log("             matches   model    Pinnacle early  Pinnacle close");
for (const [name, tally] of [
    ["all", r.logLoss],
    ["first div", r.byTier.top],
    ["second div", r.byTier.second],
] as const) {
    console.log(
        `${name.padEnd(12)} ${String(tally.matches).padStart(7)}   ${loss(tally.model)}   ${loss(tally.sharpEarly).padStart(14)}  ${loss(tally.sharpClosing).padStart(14)}`,
    );
}
console.log(`\nModel share in the fair price, scanner at ${pct(options.minEdge)} against the soft books`);
console.log("share  log loss  bets    avg CLV  beat close  flat ROI");
for (const blend of r.blends) {
    console.log(
        [
            pct(blend.weight).padEnd(6),
            loss(blend.logLoss).padStart(8),
            String(blend.bets).padStart(5),
            pct(blend.averageClv).padStart(10),
            pct(blend.beatClosing).padStart(11),
            pct(blend.flatRoi).padStart(9),
        ].join(" "),
    );
}
