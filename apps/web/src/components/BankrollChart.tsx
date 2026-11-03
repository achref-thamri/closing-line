"use client";

import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export interface ChartSeries {
    id: string;
    name: string;
    colour: string;
    /** Bankroll as a change from the start: 0.05 is 5% up. */
    points: { t: number; growth: number }[];
}

const dateLabel = (t: number) => new Date(t).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
const percentLabel = (growth: number) => `${(growth * 100).toFixed(1)}%`;

/**
 * Bankroll growth over time, one line per player, stepping at each settled bet. Growth rather than kroner, because
 * players start with different bankrolls.
 */
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
                    <YAxis tickFormatter={percentLabel} width={64} domain={["auto", "auto"]} />
                    <Tooltip
                        labelFormatter={(t) => dateLabel(Number(t))}
                        formatter={(growth) => percentLabel(Number(growth))}
                    />
                    <Legend />
                    {series.map((line) => (
                        <Line
                            key={line.id}
                            data={line.points}
                            dataKey="growth"
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
