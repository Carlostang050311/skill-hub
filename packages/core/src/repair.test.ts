import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { makeTempDir, writeSkill } from "./test-utils.js";
import { scanAll, defaultRoots } from "./scanner.js";
import { applySkillEdit, previewSkillEdit, repairSuggestions } from "./repair.js";
import { restoreSkillBackup } from "./backups.js";

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });
describe("修复预览与复测准备", () => {
  it("预览不会写入；应用保存全目录备份，资源保留，恢复可撤销", () => {
    const home = makeTempDir(); dirs.push(home);
    const original = "---\nname: demo\n---\n薄内容";
    const dir = writeSkill(home, ".agents/skills/demo", original, { "scripts/run.mjs": "console.log(1)" });
    const record = scanAll(defaultRoots(home)).skills[0]!;
    expect(repairSuggestions(record).length).toBeGreaterThan(1);
    const edited = "---\nname: demo\ndescription: 制作数据报告\n---\n" + "核查输入、来源、步骤与结果。".repeat(15);
    const preview = previewSkillEdit(record, edited);
    expect(preview.warningDelta).toBeLessThan(0);
    expect(fs.readFileSync(path.join(dir, "SKILL.md"), "utf8")).toBe(original);
    const state = path.join(home, ".skillhub");
    const result = applySkillEdit(record, edited, preview.expectedHash, state);
    expect(fs.readFileSync(path.join(dir, "scripts", "run.mjs"), "utf8")).toBe("console.log(1)");
    expect(result.hash).not.toBe(record.hash);
    restoreSkillBackup(path.join(state, "backups"), result.backupId!, [path.join(home, ".agents", "skills")]);
    expect(fs.readFileSync(path.join(dir, "SKILL.md"), "utf8")).toBe(original);
  });
  it("过期预览或身份变化被拒绝，不覆盖后来编辑", () => {
    const home = makeTempDir(); dirs.push(home);
    const dir = writeSkill(home, ".agents/skills/demo", "---\nname: demo\ndescription: d\n---\nbody");
    const record = scanAll(defaultRoots(home)).skills[0]!;
    const edit = "---\nname: demo\ndescription: new\n---\nbody";
    const preview = previewSkillEdit(record, edit);
    fs.writeFileSync(path.join(dir, "new.txt"), "later");
    expect(() => applySkillEdit(record, edit, preview.expectedHash, path.join(home, ".skillhub"))).toThrow(/变化/);
    expect(() => previewSkillEdit(record, edit.replace("name: demo", "name: other"))).toThrow(/name/);
    expect(fs.readFileSync(path.join(dir, "new.txt"), "utf8")).toBe("later");
  });
});
