"use client";

import { useFormatter } from "next-intl";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

/** GMV-per-day line chart. `daily` is a zero-filled serializable array. */
export function AnalyticsCharts({ daily }: { daily: { day: string; gmvVnd: number }[] }) {
  const f = useFormatter();
  return (
    <div className="h-64 w-full">
      <ResponsiveContainer>
        <LineChart data={daily}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="day" tickFormatter={(d: string) => d.slice(5)} fontSize={12} />
          <YAxis
            fontSize={12}
            tickFormatter={(v: number) =>
              v >= 1_000_000 ? `${(v / 1_000_000).toFixed(1)}M` : `${Math.round(v / 1000)}k`
            }
          />
          <Tooltip
            formatter={(v) =>
              f.number(v as number, { style: "currency", currency: "VND", currencyDisplay: "code" })
            }
          />
          <Line type="monotone" dataKey="gmvVnd" stroke="var(--primary)" dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
