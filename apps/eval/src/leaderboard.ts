import type { DatabaseSync } from "node:sqlite";
import type { RunSummaryRow } from "./db.js";

export interface LeaderboardSkill {
  name: string;
  /** 最新一次模型评测的分数 */
  overall: number | null;
  trigger: number | null;
  clarity: number | null;
  staticScore: number;
  /** 最新一次评测的 run id */
  lastRunId: number;
  /** 执行级评测（最新一次） */
  exec: { score: number; passed: number; total: number; runAt: string } | null;
}

export interface LeaderboardData {
  generatedAt: string;
  repo: string;
  runs: Array<{ id: number; startedAt: string; totalSkills: number; avgOverall: number | null }>;
  skills: LeaderboardSkill[];
}

export interface ExecRunRow {
  runAt: string;
  results: Array<{ skill: string; score: number; rubricPassed: number; rubricTotal: number }>;
}

/** 从评测库与执行级 run 汇总出榜单数据：每个 skill 取最新一次的分数 */
export function buildLeaderboardData(
  runs: RunSummaryRow[],
  fetchRunResults: (runId: number) => Array<{ skill: string; overall: number | null; triggerScore: number | null; clarityScore: number | null; staticScore: number }>,
  execRuns: ExecRunRow[],
  generatedAt: string,
): LeaderboardData {
  const bySkill = new Map<string, LeaderboardSkill>();
  for (const run of [...runs].sort((a, b) => a.id - b.id)) {
    for (const r of fetchRunResults(run.id)) {
      bySkill.set(r.skill, {
        name: r.skill,
        overall: r.overall,
        trigger: r.triggerScore,
        clarity: r.clarityScore,
        staticScore: r.staticScore,
        lastRunId: run.id,
        exec: bySkill.get(r.skill)?.exec ?? null,
      });
    }
  }
  for (const execRun of execRuns) {
    for (const r of execRun.results ?? []) {
      const existing = bySkill.get(r.skill);
      const exec = { score: r.score, passed: r.rubricPassed, total: r.rubricTotal, runAt: execRun.runAt };
      if (existing) existing.exec = exec;
      else {
        bySkill.set(r.skill, {
          name: r.skill,
          overall: null,
          trigger: null,
          clarity: null,
          staticScore: 0,
          lastRunId: 0,
          exec,
        });
      }
    }
  }
  return {
    generatedAt,
    repo: "Carlostang050311/skill-hub",
    runs: [...runs]
      .sort((a, b) => a.id - b.id)
      .map((r) => ({ id: r.id, startedAt: r.startedAt, totalSkills: r.totalSkills, avgOverall: r.avgOverall })),
    skills: [...bySkill.values()].sort(
      (a, b) => (b.overall ?? -1) - (a.overall ?? -1) || (b.exec?.score ?? -1) - (a.exec?.score ?? -1) || a.name.localeCompare(b.name),
    ),
  };
}

/** 从已打开的库读全部 run 及其结果（榜单专用，独立于 db.ts 的缓存层） */
export function collectLeaderboard(db: DatabaseSync, execRuns: ExecRunRow[], generatedAt: string): LeaderboardData {
  const rows = db.prepare("SELECT id, started_at, backend, model, total_skills, avg_trigger, avg_clarity, avg_static, avg_overall, raw_json FROM runs ORDER BY id").all() as Array<Record<string, unknown>>;
  const summaries: RunSummaryRow[] = rows.map((r) => ({
    id: Number(r.id),
    startedAt: String(r.started_at),
    backend: String(r.backend),
    model: r.model == null ? null : String(r.model),
    totalSkills: Number(r.total_skills),
    avgTrigger: r.avg_trigger == null ? null : Number(r.avg_trigger),
    avgClarity: r.avg_clarity == null ? null : Number(r.avg_clarity),
    avgStatic: Number(r.avg_static),
    avgOverall: r.avg_overall == null ? null : Number(r.avg_overall),
  }));
  const resultsById = new Map<number, Array<{ skill: string; overall: number | null; triggerScore: number | null; clarityScore: number | null; staticScore: number }>>();
  for (const r of rows) {
    try {
      const report = JSON.parse(String(r.raw_json)) as { results?: Array<{ skill: string; overall: number | null; triggerScore: number | null; clarityScore: number | null; staticScore: number }> };
      resultsById.set(Number(r.id), report.results ?? []);
    } catch {
      resultsById.set(Number(r.id), []);
    }
  }
  return buildLeaderboardData(summaries, (id) => resultsById.get(id) ?? [], execRuns, generatedAt);
}
