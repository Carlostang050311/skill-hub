import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { normalizeContent } from "./hash.js";

const IGNORED = new Set(["node_modules", ".git", ".svn", ".next", "__pycache__"]);

export interface FileFingerprint {
  path: string;
  hash: string;
  bytes: number;
  modifiedAt: number;
}

export interface DirectorySnapshot {
  hash: string;
  files: FileFingerprint[];
  modifiedAt: number;
}

export function isSkillResource(file: string): boolean {
  return !file.split(/[\\/]/).some((part) => IGNORED.has(part)) && path.basename(file) !== "skillhub.manifest.json";
}

/** 覆盖正文、脚本、模板和二进制资源；不跟随符号链接，不截断资源列表。 */
export function snapshotDirectory(dir: string): DirectorySnapshot {
  const root = fs.realpathSync(dir);
  const files: FileFingerprint[] = [];
  const visit = (current: string): void => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      const relative = path.relative(root, full).split(path.sep).join("/");
      if (!isSkillResource(relative)) continue;
      if (entry.isSymbolicLink()) throw new Error(`skill 资源含符号链接，无法可靠同步：${relative}`);
      if (entry.isDirectory()) visit(full);
      else if (entry.isFile()) {
        const content = fs.readFileSync(full);
        const canonical = path.extname(full).toLowerCase() === ".md" ? normalizeContent(content.toString("utf8")) : content;
        files.push({ path: relative, hash: createHash("sha256").update(canonical).digest("hex"), bytes: content.length, modifiedAt: fs.statSync(full).mtimeMs });
      }
    }
  };
  visit(root);
  files.sort((a, b) => a.path.localeCompare(b.path, "en"));
  const hash = createHash("sha256").update(JSON.stringify(files.map((f) => [f.path, f.hash]))).digest("hex").slice(0, 16);
  return { hash, files, modifiedAt: Math.max(0, ...files.map((f) => f.modifiedAt)) };
}

export interface DirectoryStat {
  hash: string;
  paths: string[];
  modifiedAt: number;
}

/** 轻量目录探查：只 readdir + stat，不读文件内容；用于增量扫描的资源变化检测。 */
export function statDirectory(dir: string): DirectoryStat {
  const root = fs.realpathSync(dir);
  const rows: Array<{ path: string; bytes: number; modifiedAt: number }> = [];
  const visit = (current: string): void => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      const relative = path.relative(root, full).split(path.sep).join("/");
      if (!isSkillResource(relative)) continue;
      if (entry.isSymbolicLink()) throw new Error(`skill 资源含符号链接，无法可靠同步：${relative}`);
      if (entry.isDirectory()) visit(full);
      else if (entry.isFile()) {
        const st = fs.statSync(full);
        rows.push({ path: relative, bytes: st.size, modifiedAt: st.mtimeMs });
      }
    }
  };
  visit(root);
  rows.sort((a, b) => a.path.localeCompare(b.path, "en"));
  const hash = createHash("sha256").update(JSON.stringify(rows.map((r) => [r.path, r.bytes, r.modifiedAt]))).digest("hex").slice(0, 16);
  return { hash, paths: rows.map((r) => r.path), modifiedAt: Math.max(0, ...rows.map((r) => r.modifiedAt)) };
}

export interface FileDifference {
  path: string;
  status: "added" | "changed" | "removed";
  before?: string;
  after?: string;
  binary: boolean;
  truncated: boolean;
}

function previewFile(dir: string, relative: string): { text?: string; binary: boolean; truncated: boolean } {
  const full = path.resolve(dir, relative);
  const content = fs.readFileSync(full);
  const sample = content.subarray(0, 32000);
  const binary = sample.includes(0) || sample.toString("utf8").includes("\uFFFD");
  return { text: binary ? undefined : sample.toString("utf8"), binary, truncated: content.length > sample.length };
}

/** added/removed 均以“用 source 对齐 target”这次操作为参照。 */
export function compareDirectories(sourceDir: string, targetDir: string): FileDifference[] {
  const source = snapshotDirectory(sourceDir);
  const target = fs.existsSync(targetDir) ? snapshotDirectory(targetDir) : { files: [] };
  const a = new Map(source.files.map((f) => [f.path, f]));
  const b = new Map(target.files.map((f) => [f.path, f]));
  return [...new Set([...a.keys(), ...b.keys()])].sort().flatMap((relative) => {
    const sourceFile = a.get(relative);
    const targetFile = b.get(relative);
    if (sourceFile?.hash === targetFile?.hash) return [];
    const before = targetFile ? previewFile(targetDir, relative) : { binary: false, truncated: false };
    const after = sourceFile ? previewFile(sourceDir, relative) : { binary: false, truncated: false };
    return [{ path: relative, status: !targetFile ? "added" as const : !sourceFile ? "removed" as const : "changed" as const, before: before.text, after: after.text, binary: before.binary || after.binary, truncated: before.truncated || after.truncated }];
  });
}
