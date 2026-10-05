"use client";

import type { TrendPoint } from "@/lib/trend";

const SERIES = [
  { key: "overall" as const, color: "#a78bfa", label: "overall" },
  { key: "clarity" as const, color: "#fbbf24", label: "清晰度" },
  { key: "staticScore" as const, color: "#34d399", label: "静态" },
];

/** run 平均分趋势：0-100 分度的简易折线，null 断开 */
export function TrendChart({ points }: { points: TrendPoint[] }) {
  if (points.length === 0) return null;
  const W = 840;
  const H = 220;
  const padL = 34;
  const padR = 18;
  const padT = 14;
  const padB = 26;
  const x = (i: number): number =>
    points.length === 1 ? padL + (W - padL - padR) / 2 : padL + ((W - padL - padR) * i) / (points.length - 1);
  const y = (v: number): number => padT + (H - padT - padB) * (1 - v / 100);

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full">
        {[0, 50, 100].map((v) => (
          <g key={v}>
            <line x1={padL} y1={y(v)} x2={W - padR} y2={y(v)} stroke="#1e293b" strokeWidth={1} />
            <text x={padL - 6} y={y(v) + 3.5} fontSize={10} fill="#475569" textAnchor="end">
              {v}
            </text>
          </g>
        ))}
        {SERIES.map((s) => {
          const segments: TrendPoint[][] = [];
          let current: TrendPoint[] = [];
          for (const p of points) {
            const v = p[s.key];
            if (v == null) {
              if (current.length > 0) segments.push(current);
              current = [];
            } else {
              current.push(p);
            }
          }
          if (current.length > 0) segments.push(current);
          return (
            <g key={s.key}>
              {segments.map((seg, si) => (
                <polyline
                  key={si}
                  fill="none"
                  stroke={s.color}
                  strokeWidth={1.8}
                  points={seg.map((p) => `${x(points.indexOf(p))},${y(p[s.key] ?? 0)}`).join(" ")}
                />
              ))}
              {points.map((p, i) => {
                const v = p[s.key];
                if (v == null) return null;
                return (
                  <circle key={i} cx={x(i)} cy={y(v)} r={3} fill={s.color}>
                    <title>{`run #${p.runId} ${s.label}：${v}`}</title>
                  </circle>
                );
              })}
            </g>
          );
        })}
        {points.map((p, i) => (
          <text key={p.runId} x={x(i)} y={H - 8} fontSize={10} fill="#64748b" textAnchor="middle">
            {p.label}
          </text>
        ))}
      </svg>
      <div className="mt-1 flex flex-wrap gap-4 text-xs text-slate-400">
        {SERIES.map((s) => (
          <span key={s.key} className="flex items-center gap-1.5">
            <span className="inline-block h-2 w-2 rounded-full" style={{ background: s.color }} />
            {s.label}
          </span>
        ))}
      </div>
    </div>
  );
}
