"use client";

import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { timeAxis } from "../lib/timeAxis.ts";

export interface ChartSeries {
    id: string;
    name: string;
    colour: string;
    /** A fraction at each time: 0.05 is shown as 5%. */
    points: { t: number; value: number }[];
}

const TIME_ZONE = "Europe/Copenhagen";
const fullLabel = (timestamp: number) =>
    new Date(timestamp).toLocaleString("en-GB", {
        timeZone: TIME_ZONE,
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
    });
const percentLabel = (value: number) => `${(value * 100).toFixed(1)}%`;

/**
 * A percentage over time, one line per player, stepping at each settled bet: bankroll growth (rather than kroner,
 * because players start with different bankrolls), or the running average CLV.
 */
export function PercentChart({ series, testId = "bankroll-chart" }: { series: ChartSeries[]; testId?: string }) {
    const times = series.flatMap((line) => line.points.map((point) => point.t));
    const axis = timeAxis(Math.min(...times), Math.max(...times), TIME_ZONE);
    return (
        <div className="h-72 w-full" data-testid={testId}>
            <ResponsiveContainer>
                <LineChart margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.3} />
                    <XAxis
                        dataKey="t"
                        type="number"
                        scale="time"
                        domain={["dataMin", "dataMax"]}
                        ticks={axis.ticks}
                        tickFormatter={axis.label}
                    />
                    <YAxis tickFormatter={percentLabel} width={64} domain={["auto", "auto"]} />
                    <Tooltip
                        labelFormatter={(timestamp) => fullLabel(Number(timestamp))}
                        formatter={(value) => percentLabel(Number(value))}
                    />
                    <Legend />
                    {series.map((line) => (
                        <Line
                            key={line.id}
                            data={line.points}
                            dataKey="value"
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
