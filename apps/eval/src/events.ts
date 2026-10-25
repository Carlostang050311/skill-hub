/** hook 推荐事件（hook-events.jsonl 每行） */
export interface RecommendEvent {
  ts: string;
  skill: string;
  score: number;
  taskHash: string;
  project: string;
}

export interface RecommendSkillSummary {
  name: string;
  shown: number;
  distinctTasks: number;
  projects: number;
  avgScore: number | null;
}

export interface RecommendEventsSummary {
  totalEvents: number;
  distinctTasks: number;
  distinctSkills: number;
  days: number;
  skills: RecommendSkillSummary[];
}

/** 解析事件 JSONL 行（跳过坏行） */
export function parseRecommendEvents(lines: string[]): RecommendEvent[] {
  const out: RecommendEvent[] = [];
  for (const line of lines) {
    const t = line.trim();
    if (!t) continue;
    try {
      const o = JSON.parse(t) as Record<string, unknown>;
      if (typeof o.skill === "string" && typeof o.score === "number" && typeof o.taskHash === "string") {
        out.push({
          ts: String(o.ts ?? ""),
          skill: o.skill,
          score: o.score,
          taskHash: o.taskHash,
          project: String(o.project ?? ""),
        });
      }
    } catch {
      // 坏行跳过
    }
  }
  return out;
}

/** 聚合：总次数 / 去重任务 / 分数分布（Phase 4 反馈闭环的读数层） */
export function aggregateRecommendEvents(events: RecommendEvent[]): RecommendEventsSummary {
  const bySkill = new Map<string, { shown: number; tasks: Set<string>; projects: Set<string>; scores: number[] }>();
  for (const e of events) {
    const entry = bySkill.get(e.skill) ?? { shown: 0, tasks: new Set<string>(), projects: new Set<string>(), scores: [] };
    entry.shown += 1;
    entry.tasks.add(e.taskHash);
    entry.projects.add(e.project);
    entry.scores.push(e.score);
    bySkill.set(e.skill, entry);
  }
  return {
    totalEvents: events.length,
    distinctTasks: new Set(events.map((e) => e.taskHash)).size,
    distinctSkills: bySkill.size,
    days: new Set(events.map((e) => e.ts.slice(0, 10))).size,
    skills: [...bySkill.entries()]
      .map(([name, s]) => ({
        name,
        shown: s.shown,
        distinctTasks: s.tasks.size,
        projects: s.projects.size,
        avgScore: s.scores.length ? Math.round((s.scores.reduce((a, b) => a + b, 0) / s.scores.length) * 10) / 10 : null,
      }))
      .sort((a, b) => b.shown - a.shown),
  };
}
