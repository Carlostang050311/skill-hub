#!/usr/bin/env node
import { Command } from "commander";
import fs from "node:fs";
import { pathToFileURL } from "node:url";
import {
  defaultRoots,
  findConflicts,
  installSkill,
  isTargetKind,
  outdatedReport,
  packSkill,
  parseSkillSource,
  scanAll,
  targetDirFor,
  uninstallSkill,
  type ScanRoot,
  type SkillRecord,
  type TargetKind,
} from "@skillhub/core";

const VERSION = "0.1.0";

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

  await program.parseAsync(argv, { from: "user" });
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
