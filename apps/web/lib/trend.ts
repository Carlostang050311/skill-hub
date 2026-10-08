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
  skillHash: string;
}

export interface SkillDelta {
  name: string;
  source: string;
  model: string;
  key: string;
  first: SkillDeltaEntry;
  latest: SkillDeltaEntry;
  delta: number;
}

/** 相同副本、用例、模型和后端才能比较版本；未绑定的历史结果不参与。 */
export function skillDeltas(entries: Array<{ runId: number; skill: string; overall: number; skillId?: string; skillHash?: string; scenarioHash?: string; source?: string; model?: string | null; backend?: string }>): SkillDelta[] {
  const bySkill = new Map<string, typeof entries>();
  for (const e of entries) {
    if (!e.skillId || !e.skillHash || !e.scenarioHash || !e.source || !e.model || !e.backend) continue;
    const key = JSON.stringify([e.skill, e.skillId, e.scenarioHash, e.source, e.model, e.backend]);
    const list = bySkill.get(key) ?? [];
    list.push(e);
    bySkill.set(key, list);
  }
  const out: SkillDelta[] = [];
  for (const [key, list] of bySkill) {
    if (list.length < 2) continue;
    const sorted = [...list].sort((a, b) => a.runId - b.runId);
    const first = sorted[0];
    const latest = sorted[sorted.length - 1];
    if (!first || !latest) continue;
    const delta = latest.overall - first.overall;
    if (first.skillHash === latest.skillHash) continue;
    out.push({ name: first.skill, source: first.source!, model: first.model!, key, first: { runId: first.runId, overall: first.overall, skillHash: first.skillHash! }, latest: { runId: latest.runId, overall: latest.overall, skillHash: latest.skillHash! }, delta });
  }
  return out.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
}
