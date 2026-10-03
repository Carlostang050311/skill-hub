import type { ReactNode } from "react";

const TONES: Record<string, string> = {
  slate: "bg-slate-800 text-slate-300 border-slate-700",
  violet: "bg-violet-500/15 text-violet-300 border-violet-500/30",
  emerald: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  amber: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  rose: "bg-rose-500/15 text-rose-300 border-rose-500/30",
};

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-xl border border-slate-800 bg-slate-900/60 p-5 ${className}`}>{children}</div>;
}

export function SectionTitle({ children, hint }: { children: ReactNode; hint?: ReactNode }) {
  return (
    <div className="mb-3 flex items-baseline justify-between">
      <h2 className="text-sm font-semibold tracking-wide text-slate-300">{children}</h2>
      {hint ? <span className="text-xs text-slate-500">{hint}</span> : null}
    </div>
  );
}

export function Stat({ label, value, hint, tone = "slate" }: { label: string; value: ReactNode; hint?: string; tone?: string }) {
  const color =
    tone === "rose" ? "text-rose-300" : tone === "amber" ? "text-amber-300" : tone === "violet" ? "text-violet-300" : tone === "emerald" ? "text-emerald-300" : "text-slate-100";
  return (
    <Card>
      <div className="text-xs text-slate-500">{label}</div>
      <div className={`mt-1 text-3xl font-semibold tabular-nums ${color}`}>{value}</div>
      {hint ? <div className="mt-1 text-xs text-slate-500">{hint}</div> : null}
    </Card>
  );
}

export function Badge({ children, tone = "slate" }: { children: ReactNode; tone?: string }) {
  return (
    <span className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-xs ${TONES[tone] ?? TONES.slate}`}>
      {children}
    </span>
  );
}

export function Bar({ label, value, max, tone = "violet" }: { label: string; value: number; max: number; tone?: string }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  const fill =
    tone === "rose" ? "bg-rose-400" : tone === "amber" ? "bg-amber-400" : tone === "emerald" ? "bg-emerald-400" : "bg-violet-400";
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between text-xs">
        <span className="text-slate-400">{label}</span>
        <span className="tabular-nums text-slate-300">{value}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-slate-800">
        <div className={`h-full rounded-full ${fill}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export function gradeTone(grade: string): string {
  return grade === "优" ? "emerald" : grade === "良" ? "violet" : grade === "中" ? "amber" : "rose";
}

export function Mono({ children }: { children: ReactNode }) {
  return <code className="rounded bg-slate-800/80 px-1 py-0.5 font-mono text-xs text-slate-300">{children}</code>;
}
