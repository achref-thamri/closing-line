"use client";

import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export interface ChartSeries {
    id: string;
    name: string;
    colour: string;
    points: { t: number; kr: number }[];
}

const dateLabel = (t: number) => new Date(t).toLocaleDateString("en-GB", { day: "numeric", month: "short" });

/** Bankroll over time, one line per player, stepping at each settled bet. */
export function BankrollChart({ series }: { series: ChartSeries[] }) {
    const times = series.flatMap((line) => line.points.map((point) => point.t));
    const ticks = evenTicks(Math.min(...times), Math.max(...times), 6);
    return (
        <div className="h-72 w-full" data-testid="bankroll-chart">
            <ResponsiveContainer>
                <LineChart margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.3} />
                    <XAxis
                        dataKey="t"
                        type="number"
                        scale="time"
                        domain={["dataMin", "dataMax"]}
                        ticks={ticks}
                        tickFormatter={dateLabel}
                    />
                    <YAxis
                        tickFormatter={(kr: number) => kr.toLocaleString("en-GB")}
                        width={64}
                        domain={["auto", "auto"]}
                    />
                    <Tooltip
                        labelFormatter={(t) => dateLabel(Number(t))}
                        formatter={(kr) => `${Number(kr).toLocaleString("en-GB")} kr`}
                    />
                    <Legend />
                    {series.map((line) => (
                        <Line
                            key={line.id}
                            data={line.points}
                            dataKey="kr"
                            name={line.name}
                            stroke={line.colour}
                            strokeWidth={2}
                            dot={false}
                            type="stepAfter"
                            isAnimationActive={false}
                        />
                    ))}
                </LineChart>
            </ResponsiveContainer>
        </div>
    );
}

function evenTicks(from: number, to: number, count: number): number[] {
    if (!Number.isFinite(from) || !Number.isFinite(to) || from === to) return [];
    return Array.from({ length: count }, (_, i) => from + ((to - from) * i) / (count - 1));
}
