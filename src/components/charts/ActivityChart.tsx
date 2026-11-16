"use client";

import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export interface ActivityPoint {
  day: string;
  PUBLIC_REPORTED: number;
  CUSTOMER_OBSERVED: number;
  SYNTHETIC: number;
  ANALYST_NOTE: number;
}

const SERIES = [
  { key: "PUBLIC_REPORTED", name: "Public report", color: "#527CAB" },
  { key: "CUSTOMER_OBSERVED", name: "Customer observed", color: "#91BAA4" },
  { key: "SYNTHETIC", name: "Simulated", color: "#D49B5E" },
  { key: "ANALYST_NOTE", name: "Analyst-entered", color: "#8495AA" },
] as const;

const tick = { fill: "#99A8B9", fontSize: 11, fontFamily: "var(--ct-font-mono)" };

/** Stacked event counts per UTC period by provenance, with a data-table equivalent for assistive tech. */
export function ActivityChart({ data, label, height = 230, xKey = "day" }: { data: ActivityPoint[]; label: string; height?: number; xKey?: string }) {
  const total = data.reduce((s, d) => s + d.PUBLIC_REPORTED + d.CUSTOMER_OBSERVED + d.SYNTHETIC + d.ANALYST_NOTE, 0);
  return (
    <figure className="m-0">
      <div style={{ height }} aria-hidden="true">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 6, right: 8, bottom: 0, left: -18 }} accessibilityLayer={false}>
            <CartesianGrid stroke="#253141" vertical={false} />
            <XAxis dataKey={xKey} tick={tick} tickLine={false} axisLine={{ stroke: "#253141" }} tickFormatter={(v: string) => v.slice(5)} minTickGap={8} />
            <YAxis tick={tick} tickLine={false} axisLine={false} allowDecimals={false} width={44} />
            <Tooltip
              cursor={{ fill: "rgba(121,171,240,0.06)" }}
              contentStyle={{ background: "#121A25", border: "1px solid #39485A", borderRadius: 6, fontSize: 12 }}
              labelStyle={{ color: "#E8EDF5", fontFamily: "var(--ct-font-mono)" }}
              labelFormatter={(v) => `${v} (UTC)`}
              isAnimationActive={false}
            />
            <Legend wrapperStyle={{ fontSize: 11, color: "#99A8B9" }} iconType="square" iconSize={9} />
            {SERIES.map((s) => (
              <Bar key={s.key} dataKey={s.key} name={s.name} stackId="a" fill={s.color} isAnimationActive={false} maxBarSize={28} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
      <figcaption className="ct-support mt-1">
        {label} · {total} recorded events. Simulated events are shown in amber.
      </figcaption>
      <details className="mt-2 text-[12px]">
        <summary className="cursor-pointer text-fg-2">View chart data as a table</summary>
        <div className="ct-table-wrap mt-2 max-h-56 overflow-y-auto">
          <table className="ct-table">
            <caption className="ct-sr-only">{label}</caption>
            <thead>
              <tr>
                <th scope="col">Period (UTC)</th>
                {SERIES.map((s) => (
                  <th key={s.key} scope="col" data-numeric="true">
                    {s.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.map((d) => (
                <tr key={(d as unknown as Record<string, string>)[xKey]}>
                  <td className="ct-mono">{(d as unknown as Record<string, string>)[xKey]}</td>
                  {SERIES.map((s) => (
                    <td key={s.key} data-numeric="true">
                      {d[s.key]}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}
