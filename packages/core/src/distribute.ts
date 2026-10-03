import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { hashContent } from "./hash.js";
import type { SkillRecord } from "./types.js";

export type TargetKind = "agents" | "claude" | "codex";

/** 可写目标目录；插件缓存目录由插件系统版本管理，不作为安装目标 */
export function targetDirFor(kind: TargetKind, home: string = os.homedir()): string {
  const map: Record<TargetKind, string> = {
    agents: path.join(home, ".agents", "skills"),
    claude: path.join(home, ".claude", "skills"),
    codex: path.join(home, ".codex", "skills"),
  };
  return map[kind];
}

export function isTargetKind(value: string): value is TargetKind {
  return value === "agents" || value === "claude" || value === "codex";
}

const SOURCE_PREFERENCE = ["agents", "claude", "codex"];

/** 解析安装来源：指定 from 时精确匹配，否则按 agents > claude > codex > 其他 优先 */
export function resolveSource(records: SkillRecord[], name: string, from?: string): SkillRecord | null {
  const hits = records.filter((r) => r.name === name);
  if (hits.length === 0) return null;
  if (from) return hits.find((r) => r.source === from) ?? null;
  const rank = (source: string): number => {
    const index = SOURCE_PREFERENCE.indexOf(source);
    return index === -1 ? 99 : index;
  };
  return [...hits].sort((a, b) => rank(a.source) - rank(b.source) || a.source.localeCompare(b.source))[0] ?? null;
}

function hashOfSkillFile(skillPath: string): string | null {
  try {
    return hashContent(fs.readFileSync(skillPath, "utf8"));
  } catch {
    return null;
  }
}

function countFiles(dir: string): number {
  let count = 0;
  const visit = (current: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isFile()) count += 1;
      else if (entry.isDirectory()) visit(path.join(current, entry.name));
    }
  };
  visit(dir);
  return count;
}

function skipJunk(src: string): boolean {
  return !/(^|[\\/])(node_modules|\.git)$/.test(src);
}

export interface InstallOptions {
  to: TargetKind | { dir: string };
  from?: string;
  /** 目标已存在且内容不同时覆盖 */
  force?: boolean;
  /** 只算不装 */
  dryRun?: boolean;
  home?: string;
}

export interface InstallResult {
  status: "installed" | "identical" | "conflict";
  dryRun: boolean;
  skill: string;
  sourceKind: string;
  sourcePath: string;
  sourceHash: string;
  targetPath: string;
  targetHash: string | null;
  filesCopied: number;
}

/** 把 skill 复制到目标 agent 目录；目录名沿用来源（agent 按目录扫描发现 skill） */
export function installSkill(records: SkillRecord[], name: string, opts: InstallOptions): InstallResult {
  const source = resolveSource(records, name, opts.from);
  if (!source) {
    throw new Error(`找不到 skill：${name}${opts.from ? `（来源 ${opts.from}）` : ""}`);
  }
  const targetRoot = typeof opts.to === "string" ? targetDirFor(opts.to, opts.home) : opts.to.dir;
  const destDir = path.resolve(targetRoot, source.dirName);
  const rootBoundary = path.resolve(targetRoot) + path.sep;
  if (!destDir.startsWith(rootBoundary)) {
    throw new Error(`目标路径越界：${destDir}`);
  }
  const destSkillMd = path.join(destDir, "SKILL.md");
  const targetHash = fs.existsSync(destSkillMd) ? hashOfSkillFile(destSkillMd) : null;

  if (targetHash === source.hash) {
    return {
      status: "identical", dryRun: Boolean(opts.dryRun), skill: name, sourceKind: source.source,
      sourcePath: source.skillPath, sourceHash: source.hash, targetPath: destDir, targetHash, filesCopied: 0,
    };
  }
  if (targetHash !== null && !opts.force) {
    return {
      status: "conflict", dryRun: Boolean(opts.dryRun), skill: name, sourceKind: source.source,
      sourcePath: source.skillPath, sourceHash: source.hash, targetPath: destDir, targetHash, filesCopied: 0,
    };
  }

  let filesCopied = 0;
  if (!opts.dryRun) {
    if (targetHash !== null) fs.rmSync(destDir, { recursive: true, force: true });
    fs.cpSync(source.skillDir, destDir, { recursive: true, filter: skipJunk });
    filesCopied = countFiles(destDir);
  }
  return {
    status: "installed", dryRun: Boolean(opts.dryRun), skill: name, sourceKind: source.source,
    sourcePath: source.skillPath, sourceHash: source.hash, targetPath: destDir, targetHash, filesCopied,
  };
}

/** 卸载目标目录里的 skill（按 skill 名解析目录名） */
export function uninstallSkill(records: SkillRecord[], name: string, kind: TargetKind, home?: string): boolean {
  const anyOccurrence = records.find((r) => r.name === name);
  if (!anyOccurrence) throw new Error(`找不到 skill：${name}`);
  const destDir = path.resolve(targetDirFor(kind, home), anyOccurrence.dirName);
  const rootBoundary = path.resolve(targetDirFor(kind, home)) + path.sep;
  if (!destDir.startsWith(rootBoundary)) throw new Error(`目标路径越界：${destDir}`);
  if (!fs.existsSync(path.join(destDir, "SKILL.md"))) return false;
  fs.rmSync(destDir, { recursive: true, force: true });
  return true;
}

export interface OutdatedEntry {
  name: string;
  newest: { source: string; path: string; mtimeMs: number };
  lagging: Array<{ source: string; path: string; mtimeMs: number }>;
}

function mtimeOf(skillPath: string): number {
  try {
    return fs.statSync(skillPath).mtimeMs;
  } catch {
    return 0;
  }
}

/** 更新检测：同名多副本内容漂移时，按文件修改时间猜最新，列出落后的副本 */
export function outdatedReport(records: SkillRecord[]): OutdatedEntry[] {
  const groups = new Map<string, SkillRecord[]>();
  for (const record of records) {
    const list = groups.get(record.name);
    if (list) list.push(record);
    else groups.set(record.name, [record]);
  }
  const out: OutdatedEntry[] = [];
  for (const [name, occurrences] of groups) {
    if (occurrences.length < 2) continue;
    if (new Set(occurrences.map((o) => o.hash)).size === 1) continue;
    const sorted = occurrences
      .map((rec) => ({ rec, mtimeMs: mtimeOf(rec.skillPath) }))
      .sort((a, b) => b.mtimeMs - a.mtimeMs);
    const newest = sorted[0];
    if (!newest) continue;
    const lagging = sorted
      .slice(1)
      .filter((x) => x.rec.hash !== newest.rec.hash)
      .map((x) => ({ source: x.rec.source, path: x.rec.skillPath, mtimeMs: x.mtimeMs }));
    if (lagging.length === 0) continue;
    out.push({
      name,
      newest: { source: newest.rec.source, path: newest.rec.skillPath, mtimeMs: newest.mtimeMs },
      lagging,
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

export interface PackResult {
  name: string;
  outDir: string;
  files: number;
  manifestPath: string;
}

/** 导出可发布包：干净目录（SKILL.md + 资源）+ manifest；目录推到 Git 仓库即可被 skills.sh 索引 */
export function packSkill(records: SkillRecord[], name: string, outRoot: string): PackResult {
  const source = resolveSource(records, name);
  if (!source) throw new Error(`找不到 skill：${name}`);
  const destDir = path.resolve(outRoot, source.dirName);
  const rootBoundary = path.resolve(outRoot) + path.sep;
  if (!destDir.startsWith(rootBoundary)) throw new Error(`输出路径越界：${destDir}`);
  if (fs.existsSync(destDir)) fs.rmSync(destDir, { recursive: true, force: true });
  fs.cpSync(source.skillDir, destDir, { recursive: true, filter: skipJunk });
  const files = countFiles(destDir);
  const manifest = {
    name: source.name,
    description: source.description,
    hash: source.hash,
    dirName: source.dirName,
    files,
    packedAt: new Date().toISOString(),
    sourcePath: source.skillPath,
    extraFrontmatter: source.extraFrontmatter,
  };
  const manifestPath = path.join(destDir, "skillhub.manifest.json");
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n", "utf8");
  return { name, outDir: destDir, files: files + 1, manifestPath };
}
