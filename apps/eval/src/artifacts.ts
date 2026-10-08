import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";

export type ArtifactCheckType = "exists" | "non-empty" | "json" | "contains" | "node-syntax" | "node-test";
export interface ArtifactCheck { type: ArtifactCheckType; file: string; value?: string }
export interface ArtifactCheckResult extends ArtifactCheck { pass: boolean; evidence: string }
export interface ArtifactEvidence { file: string; bytes: number; hash: string; content?: string; truncated: boolean; error?: string }
const TYPES = new Set<ArtifactCheckType>(["exists", "non-empty", "json", "contains", "node-syntax", "node-test"]);
const MAX_BYTES = 1024 * 1024;

export function parseArtifactChecks(value: unknown): ArtifactCheck[] {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new Error("execute.checks 必须是数组");
  return value.map((item: unknown) => {
    const check = item as Partial<ArtifactCheck> | null;
    if (!check || !TYPES.has(check.type as ArtifactCheckType) || typeof check.file !== "string" || !check.file.trim() || (check.type === "contains" && typeof check.value !== "string")) throw new Error("产物检查需要合法 type、file；contains 还需要 value");
    return { type: check.type!, file: check.file, value: check.value };
  });
}

function artifactPath(root: string, relative: string): string {
  if (path.isAbsolute(relative)) throw new Error("产物必须使用相对路径");
  const base = fs.realpathSync(root);
  const full = path.resolve(base, relative);
  if (!full.startsWith(base + path.sep)) throw new Error("产物路径越界");
  const parts = path.relative(base, full).split(path.sep);
  let current = base;
  for (const part of parts) {
    current = path.join(current, part);
    if (fs.lstatSync(current).isSymbolicLink()) throw new Error("产物路径包含符号链接");
  }
  if (!fs.statSync(full).isFile()) throw new Error("产物不是文件");
  return full;
}

export function inspectArtifacts(root: string, files: string[]): ArtifactEvidence[] {
  return [...new Set(files)].map((file) => {
    try {
      const full = artifactPath(root, file);
      const bytes = fs.statSync(full).size;
      const fd = fs.openSync(full, "r");
      const sample = Buffer.alloc(Math.min(bytes, 16000));
      try { fs.readSync(fd, sample, 0, sample.length, 0); } finally { fs.closeSync(fd); }
      const binary = sample.includes(0) || sample.toString("utf8").includes("\uFFFD");
      const hash = bytes <= MAX_BYTES ? createHash("sha256").update(fs.readFileSync(full)).digest("hex") : "未计算：文件超过 1 MiB";
      return { file, bytes, hash, content: binary ? undefined : sample.toString("utf8"), truncated: bytes > sample.length };
    } catch (error) {
      return { file, bytes: 0, hash: "", truncated: false, error: error instanceof Error ? error.message : String(error) };
    }
  });
}

/** 检查真实文件；Node 子进程仅使用固定参数和相对沙箱内文件，限制执行时间。 */
export function validateArtifacts(root: string, artifacts: string[], checks: ArtifactCheck[] = []): ArtifactCheckResult[] {
  const planned: ArtifactCheck[] = [...artifacts.map((file) => ({ type: "non-empty" as const, file })), ...checks];
  return planned.map((check) => {
    try {
      const full = artifactPath(root, check.file);
      const size = fs.statSync(full).size;
      if (check.type === "exists") return { ...check, pass: true, evidence: `真实文件存在，${size} bytes` };
      if (check.type === "non-empty") return { ...check, pass: size > 0, evidence: `${size} bytes` };
      if (check.type === "node-syntax" || check.type === "node-test") {
        const result = spawnSync(process.execPath, [check.type === "node-test" ? "--test" : "--check", full], { cwd: root, timeout: 15000, encoding: "utf8", maxBuffer: 64000, env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, TEMP: process.env.TEMP } });
        return { ...check, pass: result.status === 0 && !result.error, evidence: result.error?.message ?? (result.status === 0 ? `Node 检查通过\n${result.stdout.slice(0, 2000)}` : `Node 检查失败（${result.status}）\n${result.stderr.slice(0, 2000)}${result.stdout.slice(0, 2000)}`) };
      }
      if (size > MAX_BYTES) throw new Error("文件超过 1 MiB，需用专门的验收器检查");
      const text = fs.readFileSync(full, "utf8");
      if (check.type === "json") { JSON.parse(text); return { ...check, pass: true, evidence: "真实产物可解析为 JSON" }; }
      const pass = text.includes(check.value ?? "");
      return { ...check, pass, evidence: pass ? `内容包含：${check.value}` : `缺少内容：${check.value}` };
    } catch (error) {
      return { ...check, pass: false, evidence: error instanceof Error ? error.message : String(error) };
    }
  });
}
