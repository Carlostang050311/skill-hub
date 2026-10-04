import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { scanAll } from "./scanner.js";
import type { SkillRecord } from "./types.js";

/** 目录指纹：按相对路径排序，对 路径+文件内容hash 串联后再取 sha256，比单看 SKILL.md 更准 */
export function hashDir(dir: string): string {
  const root = path.resolve(dir);
  const hashes: string[] = [];
  const visit = (current: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.resolve(current, entry.name);
      if (full !== root && !full.startsWith(root + path.sep)) continue;
      if (entry.isDirectory()) {
        if (entry.name === ".git" || entry.name === "node_modules") continue;
        visit(full);
      } else if (entry.isFile()) {
        try {
          const fileHash = createHash("sha256").update(fs.readFileSync(full)).digest("hex");
          hashes.push(`${path.relative(root, full).split(path.sep).join("/")}:${fileHash}`);
        } catch {
          hashes.push(`${path.relative(root, full).split(path.sep).join("/")}:unreadable`);
        }
      }
    }
  };
  visit(root);
  return createHash("sha256").update(hashes.join("\n")).digest("hex").slice(0, 16);
}

function runGit(args: string[], cwd?: string): void {
  try {
    execFileSync("git", args, { cwd, stdio: ["ignore", "pipe", "pipe"], timeout: 180_000, encoding: "utf8" });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`git ${args[0]} 失败：${message.slice(-400)}`);
  }
}

export function githubCloneUrls(ownerRepo: string): string[] {
  return [`git@github.com:${ownerRepo}.git`, `https://github.com/${ownerRepo}.git`];
}

export interface SyncedRepo {
  dir: string;
  /** true = 拉取了上游新提交（或首次克隆），false = 缓存未变化 */
  refreshed: boolean;
}

/** 把 owner/repo 的浅克隆同步到缓存目录：存在则 fetch+reset，不存在则按 SSH→HTTPS 顺序克隆；urls 可覆盖（测试用本地仓库） */
export function syncRepoCache(ownerRepo: string, cacheRoot: string, opts?: { urls?: string[] }): SyncedRepo {
  const parts = ownerRepo.split("/");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new Error(`仓库格式应为 owner/repo：${ownerRepo}`);
  }
  // owner/repo 串接进目录名（owner__repo），不含路径分隔符，无越界可能
  const cacheRootResolved = path.resolve(cacheRoot);
  const dest = path.resolve(cacheRootResolved, `${parts[0]}__${parts[1]}`);
  if (dest !== cacheRootResolved && !dest.startsWith(cacheRootResolved + path.sep)) {
    throw new Error(`缓存路径越界：${dest}`);
  }
  if (fs.existsSync(path.join(dest, ".git"))) {
    const before = hashDir(dest);
    runGit(["fetch", "--depth", "1", "origin"], dest);
    runGit(["reset", "--hard", "FETCH_HEAD"], dest);
    const after = hashDir(dest);
    return { dir: dest, refreshed: before !== after };
  }
  fs.mkdirSync(cacheRoot, { recursive: true });
  let lastError: Error | null = null;
  for (const url of opts?.urls ?? githubCloneUrls(ownerRepo)) {
    try {
      runGit(["clone", "--quiet", "--depth", "1", url, dest]);
      return { dir: dest, refreshed: true };
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      fs.rmSync(dest, { recursive: true, force: true });
    }
  }
  throw lastError ?? new Error(`无法克隆 ${ownerRepo}`);
}

/** 在克隆缓存里发现 skill：仓库根级 skill 的名字与安装目录名取 frontmatter 名，无 frontmatter 时回退仓库名（缓存目录名是合成的） */
export function discoverSkills(cloneDir: string): SkillRecord[] {
  const basename = path.basename(path.resolve(cloneDir));
  const repoName = basename.includes("__") ? basename.split("__").slice(1).join("__") : basename;
  return scanAll([{ source: "github", path: cloneDir, sourceKind: "custom", maxDepth: 7 }]).skills.map((r) => {
    if (r.relativeId !== "") return r;
    return r.name !== r.dirName
      ? { ...r, dirName: r.name }
      : { ...r, name: repoName, dirName: repoName };
  });
}

// ---------- 来源注册表（~/.skillhub/origins.json） ----------

export interface OriginEntry {
  /** 上游仓库 owner/repo */
  repo: string;
  /** skill 在仓库内的相对目录（根目录级 skill 为空串） */
  skillPath: string;
  /** 安装目录名（basename，可能与 skill 名不同） */
  dirName: string;
  /** 安装到的 agent skills 根目录 */
  targetDir: string;
  /** 安装时的目录指纹 */
  dirHash: string;
  installedAt: string;
}

export type OriginsMap = Record<string, OriginEntry>;

export function loadOrigins(file: string): OriginsMap {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
    return parsed && typeof parsed === "object" ? (parsed as OriginsMap) : {};
  } catch {
    return {};
  }
}

export function saveOrigins(file: string, origins: OriginsMap): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(origins, null, 2) + "\n", "utf8");
}

export function recordOrigin(file: string, name: string, entry: Omit<OriginEntry, "installedAt">): void {
  const origins = loadOrigins(file);
  origins[name] = { ...entry, installedAt: new Date().toISOString() };
  saveOrigins(file, origins);
}
