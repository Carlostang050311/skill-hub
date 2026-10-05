import type { RunSummaryRow } from "@skillhub/eval";

export interface TrendPoint {
  runId: number;
  /** 展示标签：#9 */
  label: string;
  overall: number | null;
  trigger: number | null;
  clarity: number | null;
  staticScore: number;
  skills: number;
}

/** run 摘要（倒序入库）转成按时间正序的图表点 */
export function buildTrend(runs: RunSummaryRow[]): TrendPoint[] {
  return [...runs]
    .reverse()
    .map((r) => ({
      runId: r.id,
      label: `#${r.id}`,
      overall: r.avgOverall == null ? null : Math.round(r.avgOverall),
      trigger: r.avgTrigger == null ? null : Math.round(r.avgTrigger),
      clarity: r.avgClarity == null ? null : Math.round(r.avgClarity),
      staticScore: Math.round(r.avgStatic),
      skills: r.totalSkills,
    }));
}

export interface SkillDeltaEntry {
  runId: number;
  overall: number;
}

export interface SkillDelta {
  name: string;
  first: SkillDeltaEntry;
  latest: SkillDeltaEntry;
  delta: number;
}

/** 同名 skill 跨 run 的 overall 变化（首末对比，0 变化不列） */
export function skillDeltas(entries: Array<{ runId: number; skill: string; overall: number }>): SkillDelta[] {
  const bySkill = new Map<string, SkillDeltaEntry[]>();
  for (const e of entries) {
    const list = bySkill.get(e.skill) ?? [];
    list.push({ runId: e.runId, overall: e.overall });
    bySkill.set(e.skill, list);
  }
  const out: SkillDelta[] = [];
  for (const [name, list] of bySkill) {
    if (list.length < 2) continue;
    const sorted = [...list].sort((a, b) => a.runId - b.runId);
    const first = sorted[0];
    const latest = sorted[sorted.length - 1];
    if (!first || !latest) continue;
    const delta = latest.overall - first.overall;
    if (delta === 0) continue;
    out.push({ name, first, latest, delta });
  }
  return out.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
}
