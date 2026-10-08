import fs from "node:fs";
import path from "node:path";
import { cache } from "react";
import { execBindingStatus, getRunReport, latestRun, listRuns, openDb, type ExecBinding, type RunReport, type RunSummaryRow } from "@skillhub/eval";
import { getScan } from "./data";
import { stateRoot } from "./paths";

export interface EvalData {
  runs: RunSummaryRow[];
  latest: { summary: RunSummaryRow; report: RunReport } | null;
}

/** 读取 ~/.skillhub/eval.db；文件不存在说明还没跑过评测 */
export const getEvalData = cache((): EvalData | null => {
  const dbPath = path.join(stateRoot(), "eval.db");
  if (!fs.existsSync(dbPath)) return null;
  const db = openDb(dbPath);
  return { runs: listRuns(db), latest: latestRun(db) };
});

export interface ExecSkillRow {
  skill: string;
  score: number;
  passed: number;
  total: number;
  runAt: string;
  verified: boolean;
  stale: boolean;
}

/** 执行级评测成绩：取每个 skill 最新一次的官方分。exec ingest 按相对路径写入，位置随启动目录变化，多候选探测 */
export const getExecResults = cache((): ExecSkillRow[] => {
  const candidates = [
    path.join(stateRoot(), "exec-runs.json"),
    path.join(process.cwd(), ".skillhub", "exec-runs.json"),
    path.join(process.cwd(), "..", "..", ".skillhub", "exec-runs.json"),
  ];
  const file = (process.env.SKILLHUB_HOME ? candidates.slice(0, 1) : candidates).find((p) => fs.existsSync(p));
  if (!file) return [];
  try {
    const runs = JSON.parse(fs.readFileSync(file, "utf8")) as Array<{
      runAt: string;
      results?: Array<ExecBinding & { skill: string; score: number; rubricPassed: number; rubricTotal: number; accepted?: boolean; checks?: unknown[]; status?: string }>;
    }>;
    const bySkill = new Map<string, ExecSkillRow>();
    for (const run of runs) {
      for (const r of run.results ?? []) {
        const status = execBindingStatus(r, getScan().skills);
        bySkill.set(r.skill, { skill: r.skill, score: r.score, passed: r.rubricPassed, total: r.rubricTotal, runAt: run.runAt, verified: status === "bound" && r.status === "bound" && Array.isArray(r.checks), stale: status === "stale" || r.status === "stale" });
      }
    }
    return [...bySkill.values()].sort((a, b) => a.skill.localeCompare(b.skill));
  } catch {
    return [];
  }
});

export interface FullRun {
  summary: RunSummaryRow;
  report: RunReport;
}

/** 最近 10 个 run 的完整报告（供跨 run 对比） */
export const getAllRunReports = cache((): FullRun[] => {
  const dbPath = path.join(stateRoot(), "eval.db");
  if (!fs.existsSync(dbPath)) return [];
  const db = openDb(dbPath);
  const out: FullRun[] = [];
  for (const summary of listRuns(db).slice(0, 10)) {
    const found = getRunReport(db, summary.id);
    if (found) out.push({ summary, report: found.report });
  }
  return out;
});
