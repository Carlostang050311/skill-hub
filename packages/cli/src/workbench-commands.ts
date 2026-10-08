import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Command } from "commander";
import { applySkillEdit, defaultRoots, listBackups, previewInstall, previewSkillEdit, resolveSource, restoreSkillBackup, scanAll, SKILL_PACKS, skillUsageCard, isTargetKind } from "@skillhub/core";

export function registerWorkbenchCommands(program: Command): void {
  const getHome = (home?: string) => home ?? process.env.SKILLHUB_HOME ?? os.homedir();
  const records = (home?: string) => scanAll(defaultRoots(getHome(home))).skills;
  const print = (data: unknown) => console.log(JSON.stringify(data, null, 2));
  program.command("diff <name>").description("预览完整目录同步差异，不写入文件")
    .requiredOption("--to <kind>", "agents / claude / codex").option("--from <kind>", "指定来源").option("--home <dir>", "覆盖用户主目录").option("--json", "JSON 输出")
    .action((name: string, opts: { to: string; from?: string; home?: string }) => {
      if (!isTargetKind(opts.to)) throw new Error("--to 只支持 agents / claude / codex");
      print(previewInstall(records(opts.home), name, { to: opts.to, from: opts.from, home: getHome(opts.home) }));
    });
  program.command("backups").description("列出同步与修复备份").option("--home <dir>", "覆盖用户主目录").option("--json", "JSON 输出")
    .action((opts: { home?: string }) => {
      const errors: string[] = [];
      print(listBackups(path.join(getHome(opts.home), ".skillhub", "backups"), errors));
      if (errors.length) console.error(errors.join("\n"));
    });
  program.command("restore <id>").description("恢复备份；当前内容变化时拒绝覆盖")
    .option("--home <dir>", "覆盖用户主目录").option("--expected-hash <hash>", "检查差异后确认的当前内容指纹").option("--target-missing", "确认目标目录已不存在，按空目标恢复").option("--json", "JSON 输出")
    .action((id: string, opts: { home?: string; expectedHash?: string; targetMissing?: boolean }) => {
      if (opts.targetMissing && opts.expectedHash !== undefined) throw new Error("--target-missing 与 --expected-hash 互斥");
      print(restoreSkillBackup(path.join(getHome(opts.home), ".skillhub", "backups"), id, defaultRoots(getHome(opts.home)).filter((r) => r.sourceKind !== "plugin-cache").map((r) => r.path), opts.targetMissing ? null : opts.expectedHash));
    });
  for (const apply of [false, true]) {
    const command = program.command(`${apply ? "repair" : "repair-preview"} <name>`).description(apply ? "应用已预览的指导书修复，完整备份原件" : "预览指导书修复和质量变化，不写入文件")
      .requiredOption("--file <file>", "编辑后的 SKILL.md 文件").option("--from <kind>", "指定可写来源").option("--home <dir>", "覆盖用户主目录").option("--json", "JSON 输出");
    if (apply) command.requiredOption("--expected-hash <hash>", "预览给出的目录指纹");
    command.action((name: string, opts: { file: string; from?: string; home?: string; expectedHash?: string }) => {
      const record = resolveSource(records(opts.home), name, opts.from);
      if (!record || !isTargetKind(record.source)) throw new Error("只能修复 agents / claude / codex 中的 skill，插件缓存由插件管理");
      const raw = fs.readFileSync(opts.file, "utf8");
      print(apply ? applySkillEdit(record, raw, opts.expectedHash!, path.join(getHome(opts.home), ".skillhub")) : previewSkillEdit(record, raw));
    });
  }
  program.command("kits [id]").description("查看场景技能包及本机可用情况").option("--home <dir>", "覆盖用户主目录").option("--json", "JSON 输出")
    .action((id: string | undefined, opts: { home?: string }) => {
      const library = records(opts.home);
      const packs = SKILL_PACKS.filter((p) => !id || p.id === id);
      if (!packs.length) throw new Error("找不到场景技能包");
      print(packs.map((pack) => ({ ...pack, inventory: pack.skills.map((name) => { const record = resolveSource(library, name); return { name, available: Boolean(record), card: record ? skillUsageCard(record) : undefined }; }) })));
    });
}
