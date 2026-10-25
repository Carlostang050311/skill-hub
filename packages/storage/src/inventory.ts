import { randomUUID, createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { scanAll, type RootReport, type ScanResult, type ScanRoot, type SkillRecord } from "@skillhub/core";

export const INVENTORY_SCHEMA_VERSION = 2;

export interface StoredScan {
  scanRunId: string;
  rootSignature: string;
  result: ScanResult;
}

export interface ReadScanOptions {
  /** 默认 true，保持现有 CLI/Web 的实时扫描行为；false 时复用同 roots 的最近快照。 */
  refresh?: boolean;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS schema_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS scan_runs (
  id TEXT PRIMARY KEY,
  root_signature TEXT NOT NULL,
  roots_json TEXT NOT NULL,
  scanned_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  skill_count INTEGER NOT NULL,
  failed_count INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS scan_roots (
  scan_run_id TEXT NOT NULL REFERENCES scan_runs(id) ON DELETE CASCADE,
  source TEXT NOT NULL,
  path TEXT NOT NULL,
  source_kind TEXT NOT NULL,
  exists_flag INTEGER NOT NULL,
  count INTEGER NOT NULL,
  failed INTEGER NOT NULL,
  failed_files_json TEXT NOT NULL,
  PRIMARY KEY (scan_run_id, source)
);
CREATE TABLE IF NOT EXISTS skills (
  scan_run_id TEXT NOT NULL REFERENCES scan_runs(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  extra_frontmatter_json TEXT NOT NULL,
  source TEXT NOT NULL,
  source_kind TEXT NOT NULL,
  skill_path TEXT NOT NULL,
  skill_dir TEXT NOT NULL,
  dir_name TEXT NOT NULL,
  relative_id TEXT NOT NULL,
  version TEXT,
  files_json TEXT NOT NULL,
  body_chars INTEGER NOT NULL,
  hash TEXT NOT NULL,
  content_hash TEXT,
  modified_at REAL,
  quality_json TEXT NOT NULL,
  references_json TEXT NOT NULL,
  mentions_json TEXT NOT NULL,
  scanned_at TEXT NOT NULL,
  resource_stat_hash TEXT,
  PRIMARY KEY (scan_run_id, id)
);
CREATE TABLE IF NOT EXISTS inventory_state (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  current_run_id TEXT NOT NULL REFERENCES scan_runs(id),
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_scan_runs_root_signature ON scan_runs(root_signature, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_skills_run_name ON skills(scan_run_id, name);
`;

function json(value: unknown): string {
  return JSON.stringify(value);
}

function parseJson<T>(value: unknown, label: string): T {
  try {
    return JSON.parse(String(value)) as T;
  } catch (error) {
    throw new Error(`库存 ${label} JSON 损坏：${error instanceof Error ? error.message : String(error)}`);
  }
}

function numberOrNull(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function inventoryDbPath(home: string = process.env.SKILLHUB_HOME ?? process.env.USERPROFILE ?? process.cwd()): string {
  return path.join(home, ".skillhub", "inventory.db");
}

/** roots 的完整配置摘要；用于避免不同 --root/--home 之间误复用快照。 */
export function rootSignature(roots: ScanRoot[]): string {
  const canonical = roots.map((root) => ({
    source: root.source,
    path: path.resolve(root.path),
    sourceKind: root.sourceKind,
    maxDepth: root.maxDepth ?? 5,
  }));
  return createHash("sha256").update(json(canonical)).digest("hex");
}

function failedCount(roots: RootReport[]): number {
  return roots.reduce((sum, root) => sum + root.failed, 0);
}

export class InventoryStore {
  constructor(readonly file: string) {}

  private open(): DatabaseSync {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const db = new DatabaseSync(this.file);
    db.exec("PRAGMA foreign_keys = ON");
    db.exec("PRAGMA busy_timeout = 5000");
    db.exec(SCHEMA);
    const version = db.prepare("SELECT value FROM schema_meta WHERE key = 'version'").get() as { value?: unknown } | undefined;
    // schema 迁移：幂等——列已存在（如迁移中断后的半完成状态）时跳过对应 ALTER
    const execSchema = db.exec.bind(db);
    if (!version) {
      db.prepare("INSERT INTO schema_meta (key, value) VALUES ('version', ?)").run(String(INVENTORY_SCHEMA_VERSION));
    } else if (String(version.value) === "1") {
      // v1 → v2：skills 增加 resource_stat_hash（增量扫描的资源 stat 指纹）；旧行为 NULL，下次全量扫描自动补齐
      const columns = db.prepare("PRAGMA table_info(skills)").all() as Array<{ name?: unknown }>;
      if (!columns.some((c) => c.name === "resource_stat_hash")) {
        execSchema("ALTER TABLE skills ADD COLUMN resource_stat_hash TEXT");
      }
      db.prepare("UPDATE schema_meta SET value = ? WHERE key = 'version'").run(String(INVENTORY_SCHEMA_VERSION));
    } else if (String(version.value) !== String(INVENTORY_SCHEMA_VERSION)) {
      db.close();
      throw new Error(`不支持的库存 schema 版本：${String(version.value)}，当前版本为 ${INVENTORY_SCHEMA_VERSION}`);
    }
    return db;
  }

  private withDb<T>(fn: (db: DatabaseSync) => T): T {
    const db = this.open();
    try {
      return fn(db);
    } finally {
      db.close();
    }
  }

  saveScan(result: ScanResult, roots: ScanRoot[]): StoredScan {
    const scanRunId = randomUUID();
    const signature = rootSignature(roots);
    const createdAt = new Date().toISOString();
    this.withDb((db) => {
      let committed = false;
      try {
        db.exec("BEGIN IMMEDIATE");
        db.prepare(`INSERT INTO scan_runs (id, root_signature, roots_json, scanned_at, created_at, skill_count, failed_count)
          VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
          scanRunId,
          signature,
          json(roots),
          result.scannedAt,
          createdAt,
          result.skills.length,
          failedCount(result.roots),
        );
        const insertRoot = db.prepare(`INSERT INTO scan_roots
          (scan_run_id, source, path, source_kind, exists_flag, count, failed, failed_files_json)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
        for (const root of result.roots) {
          insertRoot.run(scanRunId, root.source, root.path, root.sourceKind, root.exists ? 1 : 0, root.count, root.failed, json(root.failedFiles));
        }
        const insertSkill = db.prepare(`INSERT INTO skills
          (scan_run_id, id, name, description, extra_frontmatter_json, source, source_kind, skill_path, skill_dir,
           dir_name, relative_id, version, files_json, body_chars, hash, content_hash, modified_at, quality_json,
           references_json, mentions_json, scanned_at, resource_stat_hash)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
        for (const skill of result.skills) {
          insertSkill.run(
            scanRunId,
            skill.id,
            skill.name,
            skill.description,
            json(skill.extraFrontmatter),
            skill.source,
            skill.sourceKind,
            skill.skillPath,
            skill.skillDir,
            skill.dirName,
            skill.relativeId,
            skill.version ?? null,
            json(skill.files),
            skill.bodyChars,
            skill.hash,
            skill.contentHash ?? null,
            skill.modifiedAt ?? null,
            json(skill.quality),
            json(skill.references),
            json(skill.mentions),
            skill.scannedAt,
            skill.resourceStatHash ?? null,
          );
        }
        db.prepare(`INSERT INTO inventory_state (singleton, current_run_id, updated_at) VALUES (1, ?, ?)
          ON CONFLICT(singleton) DO UPDATE SET current_run_id = excluded.current_run_id, updated_at = excluded.updated_at`).run(scanRunId, createdAt);
        db.exec("COMMIT");
        committed = true;
      } finally {
        if (!committed) {
          try { db.exec("ROLLBACK"); } catch { /* 原始异常更有用 */ }
        }
      }
    });
    return { scanRunId, rootSignature: signature, result };
  }

  current(): StoredScan | null {
    return this.withDb((db) => {
      const state = db.prepare("SELECT current_run_id FROM inventory_state WHERE singleton = 1").get() as { current_run_id?: unknown } | undefined;
      return state?.current_run_id ? this.readRun(db, String(state.current_run_id)) : null;
    });
  }

  get(scanRunId: string): StoredScan | null {
    return this.withDb((db) => this.readRun(db, scanRunId));
  }

  private readRun(db: DatabaseSync, scanRunId: string): StoredScan | null {
    const run = db.prepare("SELECT id, root_signature, scanned_at FROM scan_runs WHERE id = ?").get(scanRunId) as { id?: unknown; root_signature?: unknown; scanned_at?: unknown } | undefined;
    if (!run) return null;
    const rootRows = db.prepare(`SELECT source, path, source_kind, exists_flag, count, failed, failed_files_json
      FROM scan_roots WHERE scan_run_id = ? ORDER BY rowid`).all(scanRunId) as Array<Record<string, unknown>>;
    const skillRows = db.prepare(`SELECT id, name, description, extra_frontmatter_json, source, source_kind, skill_path,
      skill_dir, dir_name, relative_id, version, files_json, body_chars, hash, content_hash, modified_at,
      quality_json, references_json, mentions_json, scanned_at, resource_stat_hash FROM skills WHERE scan_run_id = ? ORDER BY rowid`).all(scanRunId) as Array<Record<string, unknown>>;
    const roots: RootReport[] = rootRows.map((row) => ({
      path: String(row.path),
      source: String(row.source),
      sourceKind: String(row.source_kind) as RootReport["sourceKind"],
      exists: Number(row.exists_flag) === 1,
      count: Number(row.count),
      failed: Number(row.failed),
      failedFiles: parseJson<string[]>(row.failed_files_json, `${scanRunId}/root`),
    }));
    const skills: SkillRecord[] = skillRows.map((row) => ({
      id: String(row.id),
      name: String(row.name),
      description: String(row.description),
      extraFrontmatter: parseJson<Record<string, unknown>>(row.extra_frontmatter_json, `${scanRunId}/extra-frontmatter`),
      source: String(row.source),
      sourceKind: String(row.source_kind) as SkillRecord["sourceKind"],
      skillPath: String(row.skill_path),
      skillDir: String(row.skill_dir),
      dirName: String(row.dir_name),
      relativeId: String(row.relative_id),
      version: row.version == null ? undefined : String(row.version),
      files: parseJson<string[]>(row.files_json, `${scanRunId}/files`),
      bodyChars: Number(row.body_chars),
      hash: String(row.hash),
      contentHash: row.content_hash == null ? undefined : String(row.content_hash),
      resourceStatHash: row.resource_stat_hash == null ? undefined : String(row.resource_stat_hash),
      modifiedAt: numberOrNull(row.modified_at),
      quality: parseJson<SkillRecord["quality"]>(row.quality_json, `${scanRunId}/quality`),
      references: parseJson<string[]>(row.references_json, `${scanRunId}/references`),
      mentions: parseJson<string[]>(row.mentions_json, `${scanRunId}/mentions`),
      scannedAt: String(row.scanned_at),
    }));
    return {
      scanRunId: String(run.id),
      rootSignature: String(run.root_signature),
      result: { scannedAt: String(run.scanned_at), roots, skills },
    };
  }
}

export function readInventory(roots: ScanRoot[], file: string, options: ReadScanOptions = {}): StoredScan {
  const store = new InventoryStore(file);
  const refresh = options.refresh ?? true;
  const current = store.current();
  const signature = rootSignature(roots);
  if (!refresh && current && current.rootSignature === signature) return current;
  // 增量：同 roots 的最近快照作为 previous，内容与资源 stat 均未变的 skill 复用上次记录
  const previous = current && current.rootSignature === signature ? current.result : undefined;
  return store.saveScan(scanAll(roots, previous ? { previous } : {}), roots);
}

export function scanAndPersist(roots: ScanRoot[], file: string): StoredScan {
  return readInventory(roots, file, { refresh: true });
}
