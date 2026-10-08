import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { isSkillResource, snapshotDirectory } from "./snapshot.js";

export interface SkillBackup {
  id: string;
  createdAt: string;
  targetPath: string;
  originalHash: string;
  replacementHash: string;
}

export function listBackups(root: string): SkillBackup[] {
  if (!fs.existsSync(root)) return [];
  const backups: SkillBackup[] = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || !/^[a-f0-9-]{36}$/.test(entry.name)) continue;
    const file = path.join(root, entry.name, "backup.json");
    if (!fs.existsSync(file)) continue;
    const backup = JSON.parse(fs.readFileSync(file, "utf8")) as SkillBackup;
    if (backup.id === entry.name && typeof backup.targetPath === "string" && typeof backup.originalHash === "string" && typeof backup.replacementHash === "string") backups.push(backup);
  }
  return backups.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** 跨盘时先校验备份副本，再在目标盘交换目录；失败回滚并保留现场。 */
export function replaceSkillDirectory(source: string, target: string, backupRoot: string, expectedTargetHash: string | null): { backupId?: string; filesCopied: number } {
  const sourceHash = snapshotDirectory(source).hash;
  const id = randomUUID();
  const parent = path.dirname(target);
  fs.mkdirSync(parent, { recursive: true });
  const stage = path.join(parent, `.skillhub-stage-${id}`);
  fs.cpSync(source, stage, { recursive: true, filter: (file) => isSkillResource(path.relative(source, file)) });
  if (snapshotDirectory(stage).hash !== sourceHash) throw new Error("来源在复制过程中发生变化，保留暂存副本，未覆盖目标");
  const currentHash = fs.existsSync(target) ? snapshotDirectory(target).hash : null;
  if (currentHash !== expectedTargetHash) throw new Error("目标在预览后发生变化，请重新预览");
  let backupId: string | undefined;
  let original: string | undefined;
  let metadata: SkillBackup | undefined;
  let backupDir: string | undefined;
  if (currentHash !== null) {
    backupDir = path.join(backupRoot, id);
    if (path.resolve(backupDir).startsWith(path.resolve(target) + path.sep)) throw new Error("备份目录不能放在被覆盖的 skill 内");
    fs.mkdirSync(backupDir, { recursive: true });
    metadata = { id, createdAt: new Date().toISOString(), targetPath: path.resolve(target), originalHash: currentHash, replacementHash: sourceHash };
    original = path.join(backupDir, "skill");
    try { fs.renameSync(target, original); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EXDEV") throw error;
      fs.cpSync(target, original, { recursive: true });
      if (snapshotDirectory(original).hash !== currentHash || snapshotDirectory(target).hash !== currentHash) throw new Error("备份过程中目标发生变化，未覆盖目标");
      original = path.join(parent, `.skillhub-original-${id}`);
      fs.renameSync(target, original);
    }
    backupId = id;
  }
  try {
    fs.renameSync(stage, target);
    if (metadata && backupDir) fs.writeFileSync(path.join(backupDir, "backup.json"), JSON.stringify(metadata, null, 2) + "\n", "utf8");
  } catch (error) {
    if (original) {
      if (fs.existsSync(target)) fs.renameSync(target, stage);
      fs.renameSync(original, target);
    }
    throw error;
  }
  return { backupId, filesCopied: snapshotDirectory(target).files.length };
}

export function restoreSkillBackup(root: string, id: string, allowedRoots: string[], expectedCurrentHash?: string): { targetPath: string; backupId?: string } {
  if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error("无效备份编号");
  const backup = listBackups(root).find((b) => b.id === id);
  if (!backup) throw new Error("找不到备份");
  const target = path.resolve(backup.targetPath);
  if (!allowedRoots.some((allowed) => target.startsWith(path.resolve(allowed) + path.sep))) throw new Error("备份目标不在允许的 skill 目录内");
  const original = path.join(root, id, "skill");
  if (snapshotDirectory(original).hash !== backup.originalHash) throw new Error("备份内容已变化，拒绝恢复");
  const expected = expectedCurrentHash ?? backup.replacementHash;
  const current = fs.existsSync(target) ? snapshotDirectory(target).hash : null;
  if (current !== expected) throw new Error("当前内容已变化，请检查差异后重新恢复");
  const result = replaceSkillDirectory(original, target, root, current);
  return { targetPath: target, backupId: result.backupId };
}
