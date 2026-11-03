"use client";

import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { timeAxis } from "../lib/timeAxis.ts";

export interface ChartSeries {
    id: string;
    name: string;
    colour: string;
    /** Bankroll as a change from the start: 0.05 is 5% up. */
    points: { t: number; growth: number }[];
}

const TIME_ZONE = "Europe/Copenhagen";
const fullLabel = (t: number) =>
    new Date(t).toLocaleString("en-GB", {
        timeZone: TIME_ZONE,
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
    });
const percentLabel = (growth: number) => `${(growth * 100).toFixed(1)}%`;

/**
 * Bankroll growth over time, one line per player, stepping at each settled bet. Growth rather than kroner, because
 * players start with different bankrolls.
 */
export function BankrollChart({ series }: { series: ChartSeries[] }) {
    const times = series.flatMap((line) => line.points.map((point) => point.t));
    const axis = timeAxis(Math.min(...times), Math.max(...times), TIME_ZONE);
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
                        ticks={axis.ticks}
                        tickFormatter={axis.label}
                    />
                    <YAxis tickFormatter={percentLabel} width={64} domain={["auto", "auto"]} />
                    <Tooltip
                        labelFormatter={(t) => fullLabel(Number(t))}
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
