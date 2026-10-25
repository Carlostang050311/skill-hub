import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { extractReferences } from "./graph.js";
import { hashContent } from "./hash.js";
import { snapshotDirectory, statDirectory } from "./snapshot.js";
import { parseSkillSource, type ParsedSkill } from "./parser.js";
import { computeQuality } from "./quality.js";
import type { RootReport, ScanResult, ScanRoot, SkillRecord } from "./types.js";

const SKIP_DIRS = new Set(["node_modules", ".git", ".svn", "dist", ".next", "coverage", "__pycache__"]);
const VERSION_RE = /(?:^|\/)(\d+\.\d+\.\d+(?:[-+][\w.-]+)?)(?:\/|$)/;
/** 提及检测的最短名字长度，避开 qa、ai 这类高频短词 */
const MENTION_MIN_NAME_LEN = 4;

function escapeRegex(name: string): string {
  return name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** 第二遍：在正文中按词边界找库内其他 skill 名（软引用信号） */
function computeMentions(skills: SkillRecord[], bodies: Map<string, string>): void {
  const names = [...new Set(skills.map((s) => s.name))].filter((n) => n.length >= MENTION_MIN_NAME_LEN);
  if (names.length === 0) return;
  const pattern = new RegExp(`(?<![a-z0-9-])(${names.map(escapeRegex).join("|")})(?![a-z0-9-])`, "g");
  for (const skill of skills) {
    const body = bodies.get(skill.id);
    if (!body) continue;
    const found = new Set<string>();
    for (const m of body.matchAll(pattern)) {
      if (m[1] && m[1] !== skill.name) found.add(m[1]);
    }
    skill.mentions = [...found].sort();
  }
}

/** 本机默认扫描目录（按 agent 划分来源） */
export function defaultRoots(home: string = process.env.SKILLHUB_HOME ?? os.homedir()): ScanRoot[] {
  return [
    { source: "agents", path: path.join(home, ".agents", "skills"), sourceKind: "agents-global", maxDepth: 3 },
    { source: "claude", path: path.join(home, ".claude", "skills"), sourceKind: "claude-global", maxDepth: 3 },
    { source: "codex", path: path.join(home, ".codex", "skills"), sourceKind: "agents-global", maxDepth: 3 },
    {
      source: "claude-plugins",
      path: path.join(home, ".claude", "plugins", "cache"),
      sourceKind: "plugin-cache",
      maxDepth: 7,
    },
    {
      source: "zcode-plugins",
      path: path.join(home, ".zcode", "cli", "plugins", "cache"),
      sourceKind: "plugin-cache",
      maxDepth: 7,
    },
  ];
}

function listSkillFiles(root: string, maxDepth: number): string[] {
  const out: string[] = [];
  const visit = (dir: string, depth: number): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith(".") || SKIP_DIRS.has(entry.name)) continue;
      if (entry.isFile() && entry.name === "SKILL.md") {
        out.push(path.join(dir, entry.name));
        continue;
      }
      if (!entry.isDirectory() || depth >= maxDepth) continue;
      visit(path.join(dir, entry.name), depth + 1);
    }
  };
  visit(root, 1);
  return out;
}

function asString(value: unknown): string {
  if (typeof value === "string") return value;
  if (value == null) return "";
  return String(value);
}

function buildRecord(root: ScanRoot, skillPath: string, raw: string, parsed: ParsedSkill, scannedAt: string): SkillRecord {
  const { frontmatter, body } = parsed;
  const skillDir = path.dirname(skillPath);
  const dirName = path.basename(skillDir);
  const relativeId = path.relative(root.path, skillDir).split(path.sep).join("/");
  const name = asString(frontmatter.name).trim() || dirName;
  const description = asString(frontmatter.description);
  const extraFrontmatter: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(frontmatter)) {
    if (key !== "name" && key !== "description") extraFrontmatter[key] = value;
  }
  const snapshot = snapshotDirectory(skillDir);
  const files = snapshot.files.filter((f) => f.path !== "SKILL.md").map((f) => f.path);
  return {
    id: `${root.source}::${relativeId}`,
    name,
    description,
    extraFrontmatter,
    source: root.source,
    sourceKind: root.sourceKind,
    skillPath,
    skillDir,
    dirName,
    relativeId,
    version: relativeId.match(VERSION_RE)?.[1],
    files,
    bodyChars: body.length,
    hash: snapshot.hash,
    contentHash: hashContent(raw),
    resourceStatHash: statDirectory(skillDir).hash,
    modifiedAt: snapshot.modifiedAt,
    quality: computeQuality({ frontmatter, body, dirName, files, skillDir }),
    references: extractReferences(body),
    mentions: [],
    scannedAt,
  };
}

export interface ScanOptions {
  /** 上一次扫描结果：提供后走增量——SKILL.md 内容与资源 stat 均未变的 skill 复用上次记录，跳过解析与目录快照。 */
  previous?: ScanResult;
}

/** 扫描全部根目录；单个 skill 解析失败只计数不阻断。提供 previous 时做增量。 */
export function scanAll(roots: ScanRoot[], options: ScanOptions = {}): ScanResult {
  const scannedAt = new Date().toISOString();
  const previousByPath = new Map<string, SkillRecord>();
  for (const skill of options.previous?.skills ?? []) previousByPath.set(skill.skillPath, skill);
  const previousNamesHash = options.previous
    ? createHash("sha256").update([...new Set(options.previous.skills.map((s) => s.name))].sort().join("|")).digest("hex")
    : null;

  const skills: SkillRecord[] = [];
  const bodies = new Map<string, string>();
  const reports: RootReport[] = [];
  let parsed = 0;
  let reused = 0;
  for (const root of roots) {
    const exists = fs.existsSync(root.path);
    let count = 0;
    const failedFiles: string[] = [];
    if (exists) {
      for (const skillPath of listSkillFiles(root.path, root.maxDepth ?? 5)) {
        let raw: string;
        try {
          raw = fs.readFileSync(skillPath, "utf8");
        } catch {
          failedFiles.push(skillPath);
          continue;
        }
        const contentHash = hashContent(raw);
        const prev = previousByPath.get(skillPath);
        const skillDir = path.dirname(skillPath);
        if (prev && prev.contentHash === contentHash && prev.resourceStatHash) {
          try {
            const stat = statDirectory(skillDir);
            if (stat.hash === prev.resourceStatHash) {
              skills.push({ ...prev, scannedAt, modifiedAt: stat.modifiedAt });
              reused += 1;
              count += 1;
              continue;
            }
          } catch {
            // 目录探查失败（如符号链接）按变化处理，走完整解析
          }
        }
        try {
          const parsedSkill = parseSkillSource(raw);
          const record = buildRecord(root, skillPath, raw, parsedSkill, scannedAt);
          skills.push(record);
          bodies.set(record.id, parsedSkill.body);
          parsed += 1;
          count += 1;
        } catch {
          failedFiles.push(skillPath);
        }
      }
    }
    reports.push({
      path: root.path,
      source: root.source,
      sourceKind: root.sourceKind,
      exists,
      count,
      failed: failedFiles.length,
      failedFiles,
    });
  }

  const currentNamesHash = createHash("sha256").update([...new Set(skills.map((s) => s.name))].sort().join("|")).digest("hex");
  const namesChanged = previousNamesHash !== null && currentNamesHash !== previousNamesHash;
  computeMentions(skills, bodies);
  if (options.previous) {
    return {
      skills,
      roots: reports,
      scannedAt,
      stats: { parsed, reused, failed: reports.reduce((sum, r) => sum + r.failed, 0), mentionsStale: namesChanged && reused > 0 },
    };
  }
  return { skills, roots: reports, scannedAt };
}
