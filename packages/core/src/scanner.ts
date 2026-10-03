import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { extractReferences } from "./graph.js";
import { hashContent } from "./hash.js";
import { parseSkillSource } from "./parser.js";
import { computeQuality } from "./quality.js";
import type { RootReport, ScanResult, ScanRoot, SkillRecord } from "./types.js";

const SKIP_DIRS = new Set(["node_modules", ".git", ".svn", "dist", ".next", "coverage", "__pycache__"]);
const MAX_RESOURCE_FILES = 500;
const VERSION_RE = /(?:^|\/)(\d+\.\d+\.\d+(?:[-+][\w.-]+)?)(?:\/|$)/;

/** 本机默认扫描目录（按 agent 划分来源） */
export function defaultRoots(home: string = os.homedir()): ScanRoot[] {
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

function listResourceFiles(skillDir: string): string[] {
  const out: string[] = [];
  const visit = (dir: string): void => {
    if (out.length >= MAX_RESOURCE_FILES) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (out.length >= MAX_RESOURCE_FILES) return;
      if (SKIP_DIRS.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isFile()) {
        if (entry.name === "SKILL.md") continue;
        out.push(path.relative(skillDir, full).split(path.sep).join("/"));
      } else if (entry.isDirectory()) {
        visit(full);
      }
    }
  };
  visit(skillDir);
  return out;
}

function asString(value: unknown): string {
  if (typeof value === "string") return value;
  if (value == null) return "";
  return String(value);
}

function buildRecord(root: ScanRoot, skillPath: string, scannedAt: string): SkillRecord {
  const raw = fs.readFileSync(skillPath, "utf8");
  const { frontmatter, body } = parseSkillSource(raw);
  const skillDir = path.dirname(skillPath);
  const dirName = path.basename(skillDir);
  const relativeId = path.relative(root.path, skillDir).split(path.sep).join("/");
  const name = asString(frontmatter.name).trim() || dirName;
  const description = asString(frontmatter.description);
  const extraFrontmatter: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(frontmatter)) {
    if (key !== "name" && key !== "description") extraFrontmatter[key] = value;
  }
  const files = listResourceFiles(skillDir);
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
    hash: hashContent(raw),
    quality: computeQuality({ frontmatter, body, dirName, files, skillDir }),
    references: extractReferences(body),
    scannedAt,
  };
}

/** 扫描全部根目录；单个 skill 解析失败只计数不阻断 */
export function scanAll(roots: ScanRoot[]): ScanResult {
  const scannedAt = new Date().toISOString();
  const skills: SkillRecord[] = [];
  const reports: RootReport[] = [];
  for (const root of roots) {
    const exists = fs.existsSync(root.path);
    let count = 0;
    const failedFiles: string[] = [];
    if (exists) {
      for (const skillPath of listSkillFiles(root.path, root.maxDepth ?? 5)) {
        try {
          skills.push(buildRecord(root, skillPath, scannedAt));
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
  return { skills, roots: reports, scannedAt };
}
