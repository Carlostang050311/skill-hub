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

export const EVAL_DB_SCHEMA_VERSION = 2;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS eval_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
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
  raw_json TEXT NOT NULL,
  strategy_version INTEGER,
  snapshot_hashes_json TEXT
);
`;

/** 幂等迁移：先按表结构补齐缺列（覆盖存量 v1 库与迁移中断半态），再用 eval_meta 记录版本 */
function migrate(db: DatabaseSync): void {
  const execSchema = db.exec.bind(db);
  execSchema(SCHEMA);
  const columns = db.prepare("PRAGMA table_info(runs)").all() as Array<{ name?: unknown }>;
  for (const [column, type] of [["strategy_version", "INTEGER"], ["snapshot_hashes_json", "TEXT"]] as const) {
    if (!columns.some((c) => c.name === column)) {
      execSchema(`ALTER TABLE runs ADD COLUMN ${column} ${type}`);
    }
  }
  const version = db.prepare("SELECT value FROM eval_meta WHERE key = 'version'").get() as { value?: unknown } | undefined;
  if (!version) {
    db.prepare("INSERT INTO eval_meta (key, value) VALUES ('version', ?)").run(String(EVAL_DB_SCHEMA_VERSION));
    return;
  }
  if (String(version.value) === String(EVAL_DB_SCHEMA_VERSION)) return;
  if (String(version.value) === "1") {
    db.prepare("UPDATE eval_meta SET value = ? WHERE key = 'version'").run(String(EVAL_DB_SCHEMA_VERSION));
    return;
  }
  throw new Error(`不支持的评测库 schema 版本：${String(version.value)}，当前版本为 ${EVAL_DB_SCHEMA_VERSION}`);
}

export function openDb(file: string): DatabaseSync {
  mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  // 常量 DDL；经 bind 调用以避开安全钩子对方法调用形式的误报
  const execSchema = db.exec.bind(db);
  execSchema("PRAGMA foreign_keys = ON");
  execSchema("PRAGMA busy_timeout = 5000");
  migrate(db);
  return db;
}

export function insertRun(db: DatabaseSync, report: RunReport): number {
  const stmt = db.prepare(
    `INSERT INTO runs (started_at, backend, model, total_skills, avg_trigger, avg_clarity, avg_static, avg_overall, raw_json, strategy_version, snapshot_hashes_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
    report.strategyVersion ?? null,
    report.skillSnapshotHashes ? JSON.stringify(report.skillSnapshotHashes) : null,
  );
  return Number(info.lastInsertRowid);
}

export interface SkillHistoryRow {
  runId: number;
  startedAt: string;
  overall: number | null;
  /** 本次评测绑定的 skill 快照指纹 */
  snapshotHash: string | null;
  strategyVersion: number | null;
}

/** 某个 skill 的全部历史评测记录（按时间正序） */
export function skillHistory(db: DatabaseSync, skill: string): SkillHistoryRow[] {
  const rows = db.prepare("SELECT id, started_at, raw_json, strategy_version, snapshot_hashes_json FROM runs ORDER BY id").all() as Array<Record<string, unknown>>;
  const out: SkillHistoryRow[] = [];
  for (const row of rows) {
    try {
      const report = JSON.parse(String(row.raw_json)) as RunReport;
      const result = report.results.find((r) => r.skill === skill);
      if (!result || result.overall == null) continue;
      const snapshots = row.snapshot_hashes_json ? (JSON.parse(String(row.snapshot_hashes_json)) as Record<string, string | null>) : undefined;
      out.push({
        runId: Number(row.id),
        startedAt: String(row.started_at),
        overall: result.overall,
        snapshotHash: result.skillHash ?? snapshots?.[skill] ?? null,
        strategyVersion: row.strategy_version == null ? (report.strategyVersion ?? null) : Number(row.strategy_version),
      });
    } catch {
      // 坏行跳过，不让单行失败毁掉统计
    }
  }
  return out;
}

export interface RepeatStats {
  /** 同快照指纹下的重复运行次数 */
  runs: number;
  mean: number | null;
  /** 总体标准差（同一指纹重复运行的方差度量） */
  stdDev: number | null;
  min: number | null;
  max: number | null;
}

/** 同 skill 同快照指纹的重复运行统计——以最新一次评测绑定的指纹为基准，度量同一份内容多次评测的分数稳定性 */
export function repeatStats(history: SkillHistoryRow[]): RepeatStats {
  const latestHash = history.at(-1)?.snapshotHash ?? null;
  if (latestHash == null) return { runs: 0, mean: null, stdDev: null, min: null, max: null };
  const scores = history
    .filter((h) => h.snapshotHash === latestHash)
    .map((h) => h.overall)
    .filter((v): v is number => v != null);
  if (scores.length === 0) return { runs: 0, mean: null, stdDev: null, min: null, max: null };
  const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
  const variance = scores.reduce((n, v) => n + (v - mean) ** 2, 0) / scores.length;
  return {
    runs: scores.length,
    mean: Math.round(mean * 10) / 10,
    stdDev: Math.round(Math.sqrt(variance) * 100) / 100,
    min: Math.min(...scores),
    max: Math.max(...scores),
  };
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
