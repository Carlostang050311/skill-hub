#!/usr/bin/env node
import { Command } from "commander";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  defaultRoots,
  discoverSkills,
  findConflicts,
  hashDir,
  installSkill,
  isTargetKind,
  loadOrigins,
  outdatedReport,
  packSkill,
  parseSkillSource,
  recommendSkills,
  recordOrigin,
  scanAll,
  syncRepoCache,
  targetDirFor,
  uninstallSkill,
  type ScanRoot,
  type SkillRecord,
  type TargetKind,
} from "@skillhub/core";
import { parseSkillsFindOutput } from "./find-parse.js";

const VERSION = "0.1.0";
const ORIGINS_FILE = path.join(os.homedir(), ".skillhub", "origins.json");
const GITHUB_CACHE_ROOT = path.join(os.homedir(), ".skillhub", "github-cache");

interface GlobalOpts {
  json?: boolean;
  home?: string;
  root?: string[];
  onlyCustom?: boolean;
}

function collect(value: string, previous: string[]): string[] {
  previous.push(value);
  return previous;
}

function addGlobal(cmd: Command): void {
  cmd
    .option("--json", "以 JSON 输出")
    .option("--home <dir>", "覆盖用户主目录（默认 os.homedir()）")
    .option("--root <path>", "追加扫描目录，可重复", collect, [])
    .option("--only-custom", "只扫描 --root 指定的目录，跳过默认目录");
}

function resolveRoots(opts: GlobalOpts): ScanRoot[] {
  const roots: ScanRoot[] = opts.onlyCustom ? [] : defaultRoots(opts.home);
  for (const [i, p] of (opts.root ?? []).entries()) {
    roots.push({ source: `custom-${i + 1}`, path: p, sourceKind: "custom", maxDepth: 7 });
  }
  if (roots.length === 0) {
    throw new Error("没有可扫描的目录：请用 --root 指定，或去掉 --only-custom");
  }
  return roots;
}

interface SkillSummary {
  id: string;
  name: string;
  source: string;
  version?: string;
  description: string;
  bodyChars: number;
  files: number;
  references: string[];
  hash: string;
  warnings: string[];
}

function toSummary(r: SkillRecord): SkillSummary {
  return {
    id: r.id,
    name: r.name,
    source: r.source,
    version: r.version,
    description: r.description,
    bodyChars: r.bodyChars,
    files: r.files.length,
    references: r.references,
    hash: r.hash,
    warnings: r.quality.warnings,
  };
}

function printJson(data: unknown): void {
  console.log(JSON.stringify(data, null, 2));
}

export async function main(argv: string[]): Promise<void> {
  const program = new Command();
  program.name("skillhub").description("本地 Agent Skill 库管理与评测平台").version(VERSION);

  const scan = program.command("scan").description("扫描全部配置目录并输出摘要");
  addGlobal(scan);
  scan.option("--out <file>", "把完整扫描结果写入 JSON 文件");
  scan.action((opts: GlobalOpts & { out?: string }) => {
    const result = scanAll(resolveRoots(opts));
    if (opts.out) fs.writeFileSync(opts.out, JSON.stringify(result, null, 2), "utf8");
    if (opts.json) {
      printJson({ scannedAt: result.scannedAt, roots: result.roots, skills: result.skills.map(toSummary) });
      return;
    }
    const conflicts = findConflicts(result.skills);
    const diverged = conflicts.filter((g) => !g.identical);
    const warnings = result.skills.reduce((n, s) => n + s.quality.warnings.length, 0);
    const failed = result.roots.reduce((n, r) => n + r.failed, 0);
    console.log(`共扫描到 ${result.skills.length} 个 skill${failed ? `（解析失败 ${failed} 个）` : ""}`);
    for (const r of result.roots) {
      console.log(`  [${r.source}] ${r.exists ? "" : "（目录不存在）"}${r.path} → ${r.count}`);
      for (const f of r.failedFiles) console.log(`    ✗ 解析失败: ${f}`);
    }
    console.log(`同名 skill 组：${conflicts.length}，其中内容漂移：${diverged.length}；质量警告合计：${warnings}`);
    if (diverged.length > 0) {
      console.log(`内容漂移的同名 skill：${diverged.map((g) => g.name).join(", ")}`);
    }
  });

  const list = program.command("list").description("列出所有 skill");
  addGlobal(list);
  list.option("--source <name>", "只看某个来源");
  list.action((opts: GlobalOpts & { source?: string }) => {
    const result = scanAll(resolveRoots(opts));
    const skills = result.skills
      .filter((s) => !opts.source || s.source === opts.source)
      .sort((a, b) => a.name.localeCompare(b.name));
    if (opts.json) {
      printJson(skills.map(toSummary));
      return;
    }
    console.table(
      skills.map((s) => ({
        name: s.name,
        source: s.source,
        描述字符: s.quality.descriptionChars,
        正文: s.bodyChars,
        资源文件: s.files.length,
        警告: s.quality.warnings.length,
      })),
    );
    console.log(`共 ${skills.length} 个 skill`);
  });

  const search = program.command("search <query>").description("按名称和描述搜索 skill");
  addGlobal(search);
  search.action((query: string, opts: GlobalOpts) => {
    const result = scanAll(resolveRoots(opts));
    const q = query.toLowerCase();
    const hits = result.skills
      .map((s) => {
        const name = s.name.toLowerCase();
        let score = 0;
        if (name === q) score += 5;
        else if (name.startsWith(q)) score += 3;
        else if (name.includes(q)) score += 2;
        if (s.description.toLowerCase().includes(q)) score += 1;
        return { s, score };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score || a.s.name.localeCompare(b.s.name))
      .slice(0, 20);
    if (opts.json) {
      printJson(hits.map((x) => ({ score: x.score, ...toSummary(x.s) })));
      return;
    }
    for (const { s, score } of hits) {
      console.log(`${s.name}  [${s.source}]  匹配分 ${score}`);
      console.log(`  ${s.description.slice(0, 80)}${s.description.length > 80 ? "…" : ""}`);
    }
    console.log(`命中 ${hits.length} 个`);
  });

  const show = program.command("show <name>").description("查看 skill 详情（含正文）");
  addGlobal(show);
  show.option("--no-body", "不输出正文");
  show.action((name: string, opts: GlobalOpts & { body: boolean }) => {
    const result = scanAll(resolveRoots(opts));
    const hits = result.skills.filter((s) => s.name === name).sort((a, b) => a.source.localeCompare(b.source));
    if (hits.length === 0) {
      console.error(`找不到名为 ${name} 的 skill，先用 skillhub search 查一下`);
      process.exitCode = 1;
      return;
    }
    if (opts.json) {
      const details = hits.map((h) => ({
        ...toSummary(h),
        skillPath: h.skillPath,
        extraFrontmatter: h.extraFrontmatter,
        quality: h.quality,
        body: opts.body ? parseSkillSource(fs.readFileSync(h.skillPath, "utf8")).body : undefined,
      }));
      printJson(details);
      return;
    }
    for (const h of hits) {
      const body = opts.body ? parseSkillSource(fs.readFileSync(h.skillPath, "utf8")).body : undefined;
      console.log(`# ${h.name}  [${h.source}${h.version ? `@${h.version}` : ""}]`);
      console.log(`路径: ${h.skillPath}`);
      console.log(`描述: ${h.description || "（无）"}`);
      console.log(`正文 ${h.bodyChars} 字符 · 资源文件 ${h.files.length} 个 · hash ${h.hash}`);
      if (h.references.length > 0) console.log(`引用的其他 skill: ${h.references.join(", ")}`);
      if (h.quality.warnings.length > 0) {
        console.log("质量警告:");
        for (const w of h.quality.warnings) console.log(`  - ${w}`);
      }
      if (body !== undefined) {
        console.log("--- 正文 ---");
        console.log(body);
      }
      console.log("");
    }
  });

  const rootsCmd = program.command("roots").description("列出扫描目录与各自的 skill 数");
  addGlobal(rootsCmd);
  rootsCmd.action((opts: GlobalOpts) => {
    const result = scanAll(resolveRoots(opts));
    if (opts.json) {
      printJson(result.roots);
      return;
    }
    for (const r of result.roots) {
      console.log(`[${r.source}] ${r.exists ? "✓" : "✗"} ${r.path} → ${r.count} 个 skill`);
    }
  });

  const install = program.command("install <name>").description("把 skill 安装到目标 agent 目录");
  install
    .requiredOption("--to <kind-or-dir>", "目标：agents / claude / codex 或目录路径")
    .option("--from <source>", "指定来源（默认 agents > claude > codex 优先）")
    .option("--force", "目标内容不同时覆盖")
    .option("--dry-run", "只展示将执行的操作，不写盘")
    .option("--home <dir>", "覆盖用户主目录")
    .option("--json", "JSON 输出");
  install.action((name: string, opts: { to: string; from?: string; force?: boolean; dryRun?: boolean; home?: string; json?: boolean }) => {
    const to = resolveTarget(opts.to, opts.home);
    const result = installSkill(scanAll(defaultRoots(opts.home)).skills, name, {
      to, from: opts.from, force: opts.force, dryRun: opts.dryRun, home: opts.home,
    });
    if (opts.json) {
      printJson(result);
      return;
    }
    if (result.status === "conflict") {
      console.error(`目标已有不同内容：${result.targetPath}\n  来源 hash ${result.sourceHash} · 目标 hash ${result.targetHash}\n  加 --force 覆盖`);
      process.exitCode = 1;
      return;
    }
    if (result.status === "identical") {
      console.log(`已是最新：${result.targetPath}`);
      return;
    }
    console.log(`${result.dryRun ? "[dry-run] 将安装" : "已安装"}：${name}（${result.filesCopied} 个文件）→ ${result.targetPath}`);
  });

  const uninstall = program.command("uninstall <name>").description("从目标 agent 目录移除 skill");
  uninstall
    .requiredOption("--from <kind>", "目标：agents / claude / codex")
    .option("--home <dir>", "覆盖用户主目录")
    .option("--json", "JSON 输出");
  uninstall.action((name: string, opts: { from: string; home?: string; json?: boolean }) => {
    if (!isTargetKind(opts.from)) {
      console.error(`--from 只支持 agents / claude / codex`);
      process.exitCode = 1;
      return;
    }
    const removed = uninstallSkill(scanAll(defaultRoots(opts.home)).skills, name, opts.from, opts.home);
    if (opts.json) {
      printJson({ name, from: opts.from, removed });
      return;
    }
    console.log(removed ? `已移除：${name} ← ${targetDirFor(opts.from, opts.home)}` : `目标没有这个 skill：${name}`);
  });

  const outdated = program.command("outdated").description("同名多副本的内容漂移与落后检测");
  outdated.option("--home <dir>", "覆盖用户主目录").option("--json", "JSON 输出");
  outdated.action((opts: { home?: string; json?: boolean }) => {
    const entries = outdatedReport(scanAll(defaultRoots(opts.home)).skills);
    if (opts.json) {
      printJson(entries);
      return;
    }
    if (entries.length === 0) {
      console.log("没有落后的副本：漂移组不存在，全部同步");
      return;
    }
    for (const e of entries) {
      console.log(`${e.name}`);
      console.log(`  最新：[${e.newest.source}] ${e.newest.path}`);
      for (const l of e.lagging) {
        console.log(`  落后：[${l.source}] ${l.path}`);
      }
      console.log(`  对齐：skillhub install ${e.name} --from ${e.newest.source} --to ${e.lagging.map((l) => l.source).join("|")} --force`);
    }
  });

  const pack = program.command("pack <name>").description("导出可发布包（干净目录 + manifest，推 Git 仓库即可被 skills.sh 索引）");
  pack.option("--out <dir>", "输出根目录", "dist").option("--home <dir>", "覆盖用户主目录").option("--json", "JSON 输出");
  pack.action((name: string, opts: { out: string; home?: string; json?: boolean }) => {
    const result = packSkill(scanAll(defaultRoots(opts.home)).skills, name, opts.out);
    if (opts.json) {
      printJson(result);
      return;
    }
    console.log(`已导出：${result.outDir}（${result.files} 个文件）\n  manifest: ${result.manifestPath}`);
  });

  const githubInstall = program.command("github-install <owner/repo>").description("从 GitHub 仓库发现并安装 skill");
  githubInstall
    .option("--to <kind>", "目标：agents / claude / codex", "agents")
    .option("--skill <names>", "只装这些 skill（逗号分隔）")
    .option("--all", "发现多个 skill 时全装（默认 >1 个时只列出）")
    .option("--list", "只列出仓库里发现的 skill，不安装")
    .option("--force", "目标内容不同时覆盖")
    .option("--dry-run", "只看将执行的操作")
    .option("--json", "JSON 输出");
  githubInstall.action((ownerRepo: string, opts: { to: string; skill?: string; all?: boolean; list?: boolean; force?: boolean; dryRun?: boolean; json?: boolean }) => {
    if (!isTargetKind(opts.to)) {
      console.error("--to 只支持 agents / claude / codex");
      process.exitCode = 1;
      return;
    }
    const synced = syncRepoCache(ownerRepo, GITHUB_CACHE_ROOT);
    const records = discoverSkills(synced.dir);
    if (!opts.json) console.log(`缓存：${synced.dir}${synced.refreshed ? "（有更新）" : ""}`);
    if (records.length === 0) {
      console.error("仓库里没有发现 SKILL.md");
      process.exitCode = 1;
      return;
    }
    const byName = new Map<string, SkillRecord>();
    for (const r of records) {
      if (!byName.has(r.name)) byName.set(r.name, r);
    }
    if (opts.list || (!opts.skill && !opts.all && byName.size > 1)) {
      if (opts.json) {
        printJson({ repo: ownerRepo, skills: [...byName.values()].map((r) => ({ name: r.name, description: r.description, path: r.relativeId })) });
        return;
      }
      console.log(`发现 ${byName.size} 个 skill：`);
      for (const r of byName.values()) {
        console.log(`  ${r.name}  (${r.relativeId})`);
        console.log(`    ${r.description.slice(0, 90) || "（无描述）"}`);
      }
      if (!opts.skill && !opts.all && byName.size > 1) {
        console.log("多 skill 仓库：用 --skill <name> 指定，或 --all 全装");
      }
      return;
    }
    const names = opts.skill ? opts.skill.split(",").map((s) => s.trim()).filter(Boolean) : [...byName.keys()];
    const targetRoot = targetDirFor(opts.to as TargetKind);
    const results: Array<Record<string, unknown>> = [];
    for (const name of names) {
      try {
        const record = byName.get(name);
        if (!record) throw new Error(`仓库里没有名为 ${name} 的 skill`);
        const result = installSkill(records, name, { to: { dir: targetRoot }, force: opts.force, dryRun: opts.dryRun });
        if (result.status === "installed" && !opts.dryRun) {
          recordOrigin(ORIGINS_FILE, name, {
            repo: ownerRepo,
            skillPath: record.relativeId,
            dirName: record.dirName,
            targetDir: targetRoot,
            dirHash: hashDir(result.targetPath),
          });
        }
        results.push({ name, ...result });
        if (!opts.json) {
          const verb = result.dryRun ? "[dry-run] " : "";
          if (result.status === "installed") console.log(`${verb}已安装：${name}（${result.filesCopied} 个文件）→ ${result.targetPath}`);
          else if (result.status === "identical") console.log(`已是最新：${name}`);
          else console.log(`冲突：${name} 目标已有不同内容（加 --force 覆盖）`);
        }
      } catch (err) {
        if (opts.json) {
          results.push({ name, error: err instanceof Error ? err.message : String(err) });
        } else {
          console.error(`✗ ${name}：${err instanceof Error ? err.message : String(err)}`);
          process.exitCode = 1;
        }
      }
    }
    if (opts.json) printJson({ repo: ownerRepo, results });
  });

  const originsCmd = program.command("origins").description("skill 的 GitHub 上游注册表");
  originsCmd.option("--json", "JSON 输出");
  originsCmd.action((opts: { json?: boolean }) => {
    const origins = loadOrigins(ORIGINS_FILE);
    if (opts.json) {
      printJson(origins);
      return;
    }
    const entries = Object.entries(origins);
    if (entries.length === 0) {
      console.log("注册表为空：github-install 会自动登记；手动导入的 skill 用 origins add 登记");
      return;
    }
    for (const [name, e] of entries) {
      console.log(`${name}  ← ${e.repo} (${e.skillPath})  安装于 ${e.installedAt.slice(0, 10)}`);
    }
  });
  originsCmd
    .command("add <name> <owner/repo>")
    .description("为手动导入的 skill 登记上游（从当前安装位置取指纹）")
    .option("--path <rel>", "skill 在仓库内的相对目录（默认取目录名）")
    .option("--home <dir>", "覆盖用户主目录")
    .action((name: string, ownerRepo: string, opts: { path?: string; home?: string }) => {
      const records = scanAll(defaultRoots(opts.home)).skills;
      const record = records.filter((r) => r.name === name).sort((a, b) => a.source.localeCompare(b.source))[0];
      if (!record) {
        console.error(`本地库找不到 skill：${name}`);
        process.exitCode = 1;
        return;
      }
      if (record.sourceKind === "plugin-cache") {
        console.error("插件缓存里的 skill 由插件系统管理，不能登记为手动来源");
        process.exitCode = 1;
        return;
      }
      const targetRoot = record.skillDir.slice(0, record.skillDir.length - record.relativeId.length - 1);
      recordOrigin(ORIGINS_FILE, name, {
        repo: ownerRepo,
        skillPath: opts.path ?? record.relativeId,
        dirName: record.dirName,
        targetDir: targetRoot,
        dirHash: hashDir(record.skillDir),
      });
      console.log(`已登记：${name} ← ${ownerRepo} (${opts.path ?? record.relativeId})`);
    });

  const outdatedRemote = program.command("outdated-remote").description("对照 GitHub 上游检查已登记 skill 的更新");
  outdatedRemote.option("--apply", "把有更新的直接覆盖安装").option("--json", "JSON 输出");
  outdatedRemote.action((opts: { apply?: boolean; json?: boolean }) => {
    const origins = loadOrigins(ORIGINS_FILE);
    const entries = Object.entries(origins);
    if (entries.length === 0) {
      console.error("注册表为空：先用 github-install 或 origins add 登记");
      process.exitCode = 1;
      return;
    }
    const rows: Array<{ name: string; repo: string; status: string; detail: string }> = [];
    for (const [name, entry] of entries) {
      try {
        const synced = syncRepoCache(entry.repo, GITHUB_CACHE_ROOT);
        const upstream = discoverSkills(synced.dir).find(
          (r) =>
            r.relativeId.toLowerCase() === entry.skillPath.toLowerCase() ||
            r.name.toLowerCase() === name.toLowerCase(),
        );
        if (!upstream) {
          rows.push({ name, repo: entry.repo, status: "unknown", detail: "上游找不到该 skill" });
          continue;
        }
        const installedDir = path.join(entry.targetDir, entry.dirName || path.basename(entry.skillPath));
        if (!fs.existsSync(path.join(installedDir, "SKILL.md"))) {
          rows.push({ name, repo: entry.repo, status: "removed", detail: "本地已删除" });
          continue;
        }
        const upstreamHash = hashDir(upstream.skillDir);
        const installedHash = hashDir(installedDir);
        if (installedHash === upstreamHash) {
          rows.push({ name, repo: entry.repo, status: "up-to-date", detail: `与上游一致（${synced.refreshed ? "缓存有更新" : "缓存无变化"}）` });
          continue;
        }
        const row: { name: string; repo: string; status: string; detail: string } = {
          name,
          repo: entry.repo,
          status: "update-available",
          detail: `本地 ${installedHash} → 上游 ${upstreamHash}`,
        };
        rows.push(row);
        if (opts.apply) {
          const applied = installSkill(discoverSkills(synced.dir), upstream.name, { to: { dir: entry.targetDir }, force: true });
          if (applied.status === "installed") {
            recordOrigin(ORIGINS_FILE, name, {
              repo: entry.repo,
              skillPath: upstream.relativeId,
              dirName: upstream.dirName,
              targetDir: entry.targetDir,
              dirHash: hashDir(applied.targetPath),
            });
            row.detail += " → 已更新";
          }
        }
      } catch (err) {
        rows.push({ name, repo: entry.repo, status: "error", detail: err instanceof Error ? err.message : String(err) });
      }
    }
    if (opts.json) {
      printJson(rows);
      return;
    }
    for (const r of rows) {
      console.log(`[${r.status}] ${r.name} ← ${r.repo}`);
      if (r.status !== "up-to-date") console.log(`        ${r.detail}`);
    }
    const available = rows.filter((r) => r.status === "update-available").length;
    console.log(`共 ${rows.length} 个：最新 ${rows.filter((r) => r.status === "up-to-date").length}，有更新 ${available}${opts.apply ? "（已全部应用）" : "（--apply 应用）"}`);
  });

  const recommend = program.command("recommend <task...>").description("按任务描述推荐最合适的 skill（供人或 agent 查库）");
  recommend.option("--limit <n>", "返回条数", "5").option("--home <dir>", "覆盖用户主目录").option("--json", "JSON 输出");
  recommend.action((task: string[], opts: { limit: string; home?: string; json?: boolean }) => {
    const records = scanAll(defaultRoots(opts.home)).skills;
    const recs = recommendSkills(records, task.join(" "), Number(opts.limit) || 5);
    if (opts.json) {
      printJson(recs);
      return;
    }
    if (recs.length === 0) {
      console.log("没有找到匹配的 skill");
      return;
    }
    for (const [i, r] of recs.entries()) {
      console.log(`${i + 1}. ${r.name}  匹配分 ${r.score}`);
      for (const reason of r.reasons) console.log(`   - ${reason}`);
    }
  });

  const searchRemote = program.command("search-remote <keyword...>").description("在 skills.sh 全生态搜索 skill");
  searchRemote.option("--owner <owner>", "限定 owner").option("--json", "JSON 输出");
  searchRemote.action((keyword: string[], opts: { owner?: string; json?: boolean }) => {
    const args = ["-y", "skills", "find", keyword.join(" ")];
    if (opts.owner) args.push("--owner", opts.owner);
    const run = spawnNpx(args);
    const hits = parseSkillsFindOutput(run.stdout ?? "");
    if (opts.json) {
      printJson(hits);
      return;
    }
    if (hits.length === 0) {
      console.log("没有找到匹配的 skill" + (run.stderr ? `（${run.stderr.trim().slice(-120)}）` : ""));
      return;
    }
    for (const h of hits) {
      console.log(`${h.repo}@${h.skill}  ${h.installs} installs`);
      console.log(`  ${h.url || "(无链接)"}`);
      console.log(`  安装：skillhub adopt ${h.repo} --skill ${h.skill}`);
    }
  });

  const adopt = program.command("adopt <owner/repo>").description("把 skills.sh 生态的 skill 收编进本机管理体系（安装 + 登记 + 纳入评测覆盖）");
  adopt
    .option("--to <kind>", "目标：agents / claude / codex", "agents")
    .option("--skill <names>", "只装这些 skill（逗号分隔）")
    .option("--force", "目标内容不同时覆盖")
    .option("--home <dir>", "覆盖用户主目录")
    .option("--json", "JSON 输出");
  adopt.action((ownerRepo: string, opts: { to: string; skill?: string; force?: boolean; home?: string; json?: boolean }) => {
    if (!isTargetKind(opts.to)) {
      console.error("--to 只支持 agents / claude / codex");
      process.exitCode = 1;
      return;
    }
    const synced = syncRepoCache(ownerRepo, GITHUB_CACHE_ROOT);
    const records = discoverSkills(synced.dir);
    if (records.length === 0) {
      console.error("仓库里没有发现 SKILL.md");
      process.exitCode = 1;
      return;
    }
    const byName = new Map<string, SkillRecord>();
    for (const r of records) {
      if (!byName.has(r.name)) byName.set(r.name, r);
    }
    const names = opts.skill ? opts.skill.split(",").map((s) => s.trim()).filter(Boolean) : [...byName.keys()];
    const targetRoot = targetDirFor(opts.to as TargetKind);
    const adopted: Array<Record<string, unknown>> = [];
    for (const name of names) {
      const record = byName.get(name);
      if (!record) {
        if (opts.json) adopted.push({ name, error: `仓库里没有名为 ${name} 的 skill` });
        else console.error(`✗ ${name}：仓库里没有这个 skill`);
        process.exitCode = 1;
        continue;
      }
      try {
        const result = installSkill(records, name, { to: { dir: targetRoot }, force: opts.force });
        if (result.status === "installed") {
          recordOrigin(ORIGINS_FILE, name, {
            repo: ownerRepo,
            skillPath: record.relativeId,
            dirName: record.dirName,
            targetDir: targetRoot,
            dirHash: hashDir(result.targetPath),
          });
        }
        adopted.push({ name, status: result.status, targetPath: result.targetPath });
        if (!opts.json) {
          if (result.status === "installed") console.log(`已收编：${name} → ${result.targetPath}`);
          else if (result.status === "identical") console.log(`已是最新：${name}`);
          else console.log(`冲突：${name}（加 --force 覆盖）`);
        }
      } catch (err) {
        if (opts.json) adopted.push({ name, error: err instanceof Error ? err.message : String(err) });
        else console.error(`✗ ${name}：${err instanceof Error ? err.message : String(err)}`);
        process.exitCode = 1;
      }
    }
    if (!opts.json) {
      console.log("已登记上游（outdated-remote 可检更新）；评测覆盖将在下次 gen plan 或每周巡检自动补齐。");
    } else {
      printJson({ repo: ownerRepo, adopted, origins: "registered", evalQueue: "next gen plan" });
    }
  });

  await program.parseAsync(argv, { from: "user" });
}

/** 跨平台调 npx：直连 npx-cli.js（Windows 的 .cmd 不能被无 shell 调用；字面量命令 + 参数向量） */
function spawnNpx(args: string[]): { stdout: string; stderr: string } {
  const npxCli = path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npx-cli.js");
  if (!fs.existsSync(npxCli)) {
    return { stdout: "", stderr: `找不到 npx-cli.js（npm 安装不完整）：${npxCli}` };
  }
  const argv: string[] = [npxCli, ...args];
  try {
    const stdout = execFileSync("node", argv, {
      encoding: "utf8",
      timeout: 120_000,
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { stdout, stderr: "" };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; message?: string };
    return { stdout: e.stdout ?? "", stderr: e.stderr ?? e.message ?? String(err) };
  }
}

function resolveTarget(value: string, home?: string): TargetKind | { dir: string } {
  if (isTargetKind(value)) return value;
  return { dir: value };
}

function isDirectRun(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return import.meta.url === pathToFileURL(entry).href;
  } catch {
    return false;
  }
}

if (isDirectRun()) {
  main(process.argv.slice(2)).catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  });
}
