import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const skillhubHome = (): string => process.env.SKILLHUB_HOME ?? os.homedir();
export const stateRoot = (): string => path.join(skillhubHome(), ".skillhub");
export function projectRoot(): string {
  let dir = process.cwd();
  while (!fs.existsSync(path.join(dir, "apps", "eval", "package.json"))) {
    const parent = path.dirname(dir);
    if (parent === dir) throw new Error("无法定位 skill-hub 项目目录");
    dir = parent;
  }
  return dir;
}
