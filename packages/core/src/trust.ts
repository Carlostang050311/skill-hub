import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** 执行级评测的信任名单：名单内的 skill 才允许在沙箱中真实执行（Phase 3 信任等级的最小实现） */
export function trustedSkillsFile(home: string = process.env.SKILLHUB_HOME ?? os.homedir()): string {
  return path.join(home, ".skillhub", "trusted-skills.json");
}

export function loadTrustedSkills(file: string): string[] {
  if (!fs.existsSync(file)) return [];
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
    if (Array.isArray(parsed) && parsed.every((x) => typeof x === "string")) return parsed as string[];
    throw new Error("内容不是字符串数组");
  } catch (error) {
    const corrupt = `${file}.corrupt-${Date.now()}`;
    try { fs.renameSync(file, corrupt); } catch { /* 保留原文件 */ }
    throw new Error(`信任名单损坏，已移至 ${corrupt}，请检查后重建：${error instanceof Error ? error.message : String(error)}`);
  }
}

export function trustSkill(file: string, name: string): boolean {
  const names = new Set(loadTrustedSkills(file));
  if (names.has(name)) return false;
  names.add(name);
  writeTrusted(file, [...names].sort());
  return true;
}

export function untrustSkill(file: string, name: string): boolean {
  const names = new Set(loadTrustedSkills(file));
  if (!names.has(name)) return false;
  names.delete(name);
  writeTrusted(file, [...names].sort());
  return true;
}

function writeTrusted(file: string, names: string[]): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(names, null, 2) + "\n", "utf8");
  fs.renameSync(tmp, file);
}
