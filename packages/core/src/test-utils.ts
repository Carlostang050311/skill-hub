import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** 仅测试使用：创建临时目录并在结束后由调用方负责删除 */
export function makeTempDir(prefix = "skillhub-test-"): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

/** 在 root 下按相对路径造一个 skill 目录，写入 SKILL.md 和附属文件 */
export function writeSkill(
  root: string,
  relDir: string,
  skillMd: string,
  extraFiles: Record<string, string> = {},
): string {
  const dir = path.resolve(root, relDir);
  if (dir !== root && !dir.startsWith(root + path.sep)) {
    throw new Error(`测试夹具路径越界：${relDir}`);
  }
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "SKILL.md"), skillMd);
  for (const [rel, content] of Object.entries(extraFiles)) {
    const target = path.resolve(dir, rel);
    if (target !== dir && !target.startsWith(dir + path.sep)) {
      throw new Error(`测试夹具路径越界：${rel}`);
    }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  }
  return dir;
}
