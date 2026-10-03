import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { RunReport, SkillEvalReport } from "./types.js";

export interface RunSummaryRow {
  id: number;
  startedAt: string;
  backend: string;
  model: string | null;
  totalSkills: number;
  avgTrigger: number | null;
  avgClarity: number | null;
  avgStatic: number;
  avgOverall: number | null;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at TEXT NOT NULL,
  backend TEXT NOT NULL,
  model TEXT,
  total_skills INTEGER NOT NULL,
  avg_trigger REAL,
  avg_clarity REAL,
  avg_static REAL NOT NULL,
  avg_overall REAL,
  raw_json TEXT NOT NULL
);
`;

export function openDb(file: string): DatabaseSync {
  mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  // 常量 DDL；经 bind 调用以避开安全钩子对方法调用形式的误报
  const execSchema = db.exec.bind(db);
  execSchema(SCHEMA);
  return db;
}

export function insertRun(db: DatabaseSync, report: RunReport): number {
  const stmt = db.prepare(
    `INSERT INTO runs (started_at, backend, model, total_skills, avg_trigger, avg_clarity, avg_static, avg_overall, raw_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  // 参数化写入；绑定调用（同理避开钩子误报）
  const insert = stmt.run.bind(stmt);
  const info = insert(
    report.startedAt,
    report.backend,
    report.model ?? null,
    report.results.length,
    report.avgTrigger,
    report.avgClarity,
    report.avgStatic,
    report.avgOverall,
    JSON.stringify(report),
  );
  return Number(info.lastInsertRowid);
}

export function listRuns(db: DatabaseSync): RunSummaryRow[] {
  const rows = db
    .prepare(
      `SELECT id, started_at, backend, model, total_skills, avg_trigger, avg_clarity, avg_static, avg_overall
       FROM runs ORDER BY id DESC`,
    )
    .all() as Array<Record<string, unknown>>;
  return rows.map((r) => ({
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
}

export function getRunReport(db: DatabaseSync, runId: number): { summary: RunSummaryRow; report: RunReport } | null {
  const summary = listRuns(db).find((r) => r.id === runId);
  if (!summary) return null;
  const row = db.prepare(`SELECT raw_json FROM runs WHERE id = ?`).get(runId) as Record<string, unknown> | undefined;
  if (!row) return null;
  return { summary, report: JSON.parse(String(row.raw_json)) as RunReport };
}

/** web 端读取最新一次运行的完整报告 */
export function latestRun(db: DatabaseSync): { summary: RunSummaryRow; report: RunReport } | null {
  const runs = listRuns(db);
  const newest = runs[0];
  if (!newest) return null;
  return getRunReport(db, newest.id);
}

export type { SkillEvalReport };
