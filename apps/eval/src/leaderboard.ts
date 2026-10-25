import type { DatabaseSync } from "node:sqlite";
import { repeatStats, type RunSummaryRow } from "./db.js";

export interface LeaderboardSkill {
  name: string;
  /** 最新一次模型评测的分数 */
  overall: number | null;
  trigger: number | null;
  clarity: number | null;
  staticScore: number;
  /** 最新一次评测的 run id */
  lastRunId: number;
  status?: "complete" | "incomplete" | "stale" | "unverified";
  skillHash?: string;
  /** 评测绑定的 skill 快照指纹（结果只对同指纹内容有效） */
  snapshotBound?: boolean;
  /** 评分策略版本（最新一次评测时） */
  strategyVersion?: number | null;
  /** 同快照指纹重复运行稳定性（最新指纹为基准；runs<2 时 stability 为 null） */
  stability?: { runs: number; stdDev: number | null; mean: number | null } | null;
  /** 执行级评测（最新一次） */
  exec: { score: number; passed: number; total: number; runAt: string; verified?: boolean; skillId?: string; skillHash?: string; scenarioHash?: string; status?: string } | null;
}

export interface LeaderboardData {
  generatedAt: string;
  repo: string;
  runs: Array<{ id: number; startedAt: string; totalSkills: number; avgOverall: number | null }>;
  skills: LeaderboardSkill[];
}

export interface ExecRunRow {
  runAt: string;
  results: Array<{ skill: string; score: number; rubricPassed: number; rubricTotal: number; checks?: unknown[]; skillId?: string; skillHash?: string; scenarioHash?: string; status?: string }>;
}

interface LeaderboardReportRow { skill: string; overall: number | null; triggerScore: number | null; clarityScore: number | null; staticScore: number; skillHash?: string; status?: "complete" | "incomplete" | "stale" }

/** 从评测库与执行级 run 汇总出榜单数据：每个 skill 取最新一次的分数 */
export function buildLeaderboardData(
  runs: RunSummaryRow[],
  fetchRunResults: (runId: number) => LeaderboardReportRow[],
  execRuns: ExecRunRow[],
  generatedAt: string,
  /** 可选：runId → 评分策略版本与快照指纹表（用于绑定标记与稳定性） */
  runMeta?: Map<number, { strategyVersion: number | null; snapshotHashes: Record<string, string | null> }>,
): LeaderboardData {
  const bySkill = new Map<string, LeaderboardSkill>();
  const historyBySkill = new Map<string, Array<{ runId: number; overall: number | null; snapshotHash: string | null }>>();
  for (const run of [...runs].sort((a, b) => a.id - b.id)) {
    for (const r of fetchRunResults(run.id)) {
      const meta = runMeta?.get(run.id);
      const snapshotHash = r.skillHash ?? meta?.snapshotHashes?.[r.skill] ?? null;
      bySkill.set(r.skill, {
        name: r.skill,
        overall: r.overall,
        trigger: r.triggerScore,
        clarity: r.clarityScore,
        staticScore: r.staticScore,
        lastRunId: run.id,
        status: r.skillHash && r.status ? r.status : "unverified",
        skillHash: r.skillHash,
        snapshotBound: snapshotHash != null,
        strategyVersion: meta?.strategyVersion ?? null,
        exec: bySkill.get(r.skill)?.exec ?? null,
      });
      const list = historyBySkill.get(r.skill) ?? [];
      list.push({ runId: run.id, overall: r.overall, snapshotHash });
      historyBySkill.set(r.skill, list);
    }
  }
  // 稳定性：以每个 skill 最新一次评测绑定的指纹为基准（repeatStats 同口径）
  for (const [name, entry] of bySkill) {
    const history = historyBySkill.get(name) ?? [];
    const rows = history
      .filter((h) => h.snapshotHash != null)
      .map((h) => ({ runId: h.runId, startedAt: "", overall: h.overall, snapshotHash: h.snapshotHash, strategyVersion: null }));
    if (rows.length === 0) {
      entry.stability = null;
    } else {
      const stats = repeatStats(rows);
      entry.stability = stats.runs > 0 ? { runs: stats.runs, stdDev: stats.stdDev, mean: stats.mean } : null;
    }
  }
  for (const execRun of execRuns) {
    for (const r of execRun.results ?? []) {
      const existing = bySkill.get(r.skill);
      const exec = { score: r.score, passed: r.rubricPassed, total: r.rubricTotal, runAt: execRun.runAt, verified: r.status === "bound" && Boolean(r.skillId && r.skillHash && r.scenarioHash) && Array.isArray(r.checks), skillId: r.skillId, skillHash: r.skillHash, scenarioHash: r.scenarioHash, status: r.status ?? "unverified" };
      if (existing) existing.exec = exec;
      else {
        bySkill.set(r.skill, {
          name: r.skill,
          overall: null,
          trigger: null,
          clarity: null,
          staticScore: 0,
          lastRunId: 0,
          status: "unverified",
          snapshotBound: false,
          stability: null,
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
  const rows = db.prepare("SELECT id, started_at, backend, model, total_skills, avg_trigger, avg_clarity, avg_static, avg_overall, raw_json, strategy_version, snapshot_hashes_json FROM runs ORDER BY id").all() as Array<Record<string, unknown>>;
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
  const resultsById = new Map<number, LeaderboardReportRow[]>();
  const runMeta = new Map<number, { strategyVersion: number | null; snapshotHashes: Record<string, string | null> }>();
  for (const r of rows) {
    const id = Number(r.id);
    try {
      const report = JSON.parse(String(r.raw_json)) as { results?: LeaderboardReportRow[]; strategyVersion?: number; skillSnapshotHashes?: Record<string, string | null> };
      resultsById.set(id, report.results ?? []);
      runMeta.set(id, {
        strategyVersion: r.strategy_version != null ? Number(r.strategy_version) : (report.strategyVersion ?? null),
        snapshotHashes: report.skillSnapshotHashes ?? {},
      });
    } catch {
      resultsById.set(id, []);
    }
  }
  return buildLeaderboardData(summaries, (id) => resultsById.get(id) ?? [], execRuns, generatedAt, runMeta);
}
