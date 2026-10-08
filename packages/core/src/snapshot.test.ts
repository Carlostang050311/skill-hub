import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { makeTempDir, writeSkill } from "./test-utils.js";
import { compareDirectories, snapshotDirectory } from "./snapshot.js";
import { installSkill, previewInstall } from "./distribute.js";
import { listBackups, restoreSkillBackup, replaceSkillDirectory } from "./backups.js";
import { defaultRoots, scanAll } from "./scanner.js";
import { findConflicts } from "./groups.js";

const dirs: string[] = [];
function fixture() {
  const home = makeTempDir("skillhub-snapshot-");
  dirs.push(home);
  const md = "---\nname: demo\ndescription: 演示资源同步\n---\n" + "说明".repeat(80);
  const a = writeSkill(home, ".agents/skills/demo", md, { "scripts/run.mjs": "console.log('new')", "new.txt": "added" });
  const b = writeSkill(home, ".claude/skills/demo", md.replace(/\n/g, "\r\n"), { "scripts/run.mjs": "console.log('old')", "old.txt": "removed" });
  return { home, a, b, backups: path.join(home, ".skillhub", "backups") };
}
afterEach(() => { vi.restoreAllMocks(); for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });

describe("完整目录指纹与同步恢复", () => {
  it.each([false, true])("备份清单写入中断时恢复目标且不公开残缺备份（跨卷 %s）", (crossVolume) => {
    const { a, b, backups } = fixture();
    const old = snapshotDirectory(b).hash;
    const rename = fs.renameSync.bind(fs);
    if (crossVolume) vi.spyOn(fs, "renameSync").mockImplementation((from, to) => {
      if (String(from) === b && String(to).startsWith(backups)) throw Object.assign(new Error("cross volume"), { code: "EXDEV" });
      rename(from, to);
    });
    const write = fs.writeFileSync.bind(fs);
    vi.spyOn(fs, "writeFileSync").mockImplementation((file, data, options) => {
      if (String(file).startsWith(backups)) { write(file, '{"id":', options); throw new Error("metadata write failed"); }
      write(file, data, options);
    });
    expect(() => replaceSkillDirectory(a, b, backups, old)).toThrow("metadata write failed");
    expect(snapshotDirectory(b).hash).toBe(old);
    expect(listBackups(backups)).toEqual([]);
  });
  it("坏清单和无效日期单独报告，正常备份仍可列出与恢复", () => {
    const { a, b, backups } = fixture();
    const old = snapshotDirectory(b).hash;
    const good = replaceSkillDirectory(a, b, backups, old);
    for (const [id, text] of [
      ["11111111-1111-1111-1111-111111111111", '{"id":'],
      ["22222222-2222-2222-2222-222222222222", JSON.stringify({ ...listBackups(backups)[0], id: "22222222-2222-2222-2222-222222222222", createdAt: null })],
    ]) {
      fs.mkdirSync(path.join(backups, id!), { recursive: true });
      fs.writeFileSync(path.join(backups, id!, "backup.json"), text!);
    }
    const errors: string[] = [];
    expect(listBackups(backups, errors).map((backup) => backup.id)).toEqual([good.backupId]);
    expect(errors).toHaveLength(2);
    expect(errors[0]).toContain("11111111-1111-1111-1111-111111111111");
    restoreSkillBackup(backups, good.backupId!, [path.dirname(b)]);
    expect(snapshotDirectory(b).hash).toBe(old);
  });
  it("跨卷备份采用复制校验，交换失败回滚且不发布伪备份", () => {
    const { home, a, b, backups } = fixture();
    const old = snapshotDirectory(b).hash;
    const rename = fs.renameSync.bind(fs);
    let failSwap = true;
    vi.spyOn(fs, "renameSync").mockImplementation((from, to) => {
      if (String(from) === b && String(to).startsWith(backups)) throw Object.assign(new Error("cross volume"), { code: "EXDEV" });
      if (String(from).includes(".skillhub-stage-") && failSwap) throw new Error("exchange failed");
      rename(from, to);
    });
    expect(() => replaceSkillDirectory(a, b, backups, old)).toThrow("exchange failed");
    expect(snapshotDirectory(b).hash).toBe(old);
    expect(listBackups(backups)).toEqual([]);
    expect(scanAll(defaultRoots(home)).skills).toHaveLength(2);
    failSwap = false;
    const result = replaceSkillDirectory(a, b, backups, old);
    expect(listBackups(backups)[0]?.id).toBe(result.backupId);
    expect(snapshotDirectory(b).hash).toBe(snapshotDirectory(a).hash);
    expect(scanAll(defaultRoots(home)).skills).toHaveLength(2);
    restoreSkillBackup(backups, result.backupId!, [path.dirname(b)]);
    expect(snapshotDirectory(b).hash).toBe(old);
  });
  it("仅资源变化也产生漂移，Markdown 行尾差异不产生漂移", () => {
    const { home, a, b } = fixture();
    const scan = scanAll(defaultRoots(home));
    expect(scan.skills[0]?.contentHash).toBe(scan.skills[1]?.contentHash);
    expect(findConflicts(scan.skills)[0]?.identical).toBe(false);
    fs.writeFileSync(path.join(a, "SKILL.md"), fs.readFileSync(path.join(b, "SKILL.md"), "utf8"));
    expect(snapshotDirectory(a).hash).not.toBe(snapshotDirectory(b).hash);
    expect(compareDirectories(a, b).map((f) => [f.path, f.status])).toEqual([["new.txt", "added"], ["old.txt", "removed"], ["scripts/run.mjs", "changed"]]);
  });
  it("资源修改不会被 identical 短路；同步备份并完整恢复旧资源", () => {
    const { home, a, b, backups } = fixture();
    const old = snapshotDirectory(b).hash;
    const result = installSkill(scanAll(defaultRoots(home)).skills, "demo", { to: "claude", from: "agents", home, force: true });
    expect(result.status).toBe("installed");
    expect(result.backupId).toBeTruthy();
    expect(snapshotDirectory(b).hash).toBe(snapshotDirectory(a).hash);
    expect(fs.existsSync(path.join(b, "old.txt"))).toBe(false);
    expect(listBackups(backups)[0]?.originalHash).toBe(old);
    const restored = restoreSkillBackup(backups, result.backupId!, [path.join(home, ".claude", "skills")]);
    expect(restored.backupId).toBeTruthy();
    expect(snapshotDirectory(b).hash).toBe(old);
    expect(fs.readFileSync(path.join(b, "scripts", "run.mjs"), "utf8")).toContain("old");
  });
  it("预览之后来源或目标变动时拒绝覆盖；恢复不会丢失后来编辑", () => {
    const { home, a, b, backups } = fixture();
    const records = scanAll(defaultRoots(home)).skills;
    const preview = previewInstall(records, "demo", { to: "claude", from: "agents", home });
    fs.writeFileSync(path.join(b, "new-edit.txt"), "keep");
    expect(() => installSkill(records, "demo", { to: "claude", from: "agents", home, force: true, expectedTargetHash: preview.targetHash })).toThrow(/变化/);
    fs.writeFileSync(path.join(a, "new.txt"), "source changed");
    expect(() => installSkill(records, "demo", { to: "claude", from: "agents", home, force: true })).toThrow(/来源/);
    const installed = installSkill(scanAll(defaultRoots(home)).skills, "demo", { to: "claude", from: "agents", home, force: true });
    fs.writeFileSync(path.join(b, "later.txt"), "keep later");
    expect(() => restoreSkillBackup(backups, installed.backupId!, [path.join(home, ".claude", "skills")])).toThrow(/当前内容已变化/);
    expect(fs.readFileSync(path.join(b, "later.txt"), "utf8")).toBe("keep later");
    expect(() => restoreSkillBackup(backups, installed.backupId!, [path.join(home, "elsewhere")])).toThrow(/允许/);
  });
  it("目标移走后可显式预览空目录并恢复，预览后出现新目标会拒绝覆盖", () => {
    const { home, a, b, backups } = fixture();
    const old = snapshotDirectory(b).hash;
    const installed = replaceSkillDirectory(a, b, backups, old);
    fs.renameSync(b, path.join(home, "moved-copy"));
    expect(compareDirectories(path.join(backups, installed.backupId!, "skill"), b).every((file) => file.status === "added")).toBe(true);
    expect(() => restoreSkillBackup(backups, installed.backupId!, [path.dirname(b)])).toThrow(/当前内容已变化/);
    restoreSkillBackup(backups, installed.backupId!, [path.dirname(b)], null);
    expect(snapshotDirectory(b).hash).toBe(old);
    expect(() => restoreSkillBackup(backups, installed.backupId!, [path.dirname(b)], null)).toThrow(/当前内容已变化/);
  });
  it("二进制内容、文件路径变化会影响指纹，构建垃圾不影响", () => {
    const { a } = fixture();
    const before = snapshotDirectory(a).hash;
    fs.mkdirSync(path.join(a, "node_modules"));
    fs.writeFileSync(path.join(a, "node_modules", "junk"), "junk");
    expect(snapshotDirectory(a).hash).toBe(before);
    fs.writeFileSync(path.join(a, "image.bin"), Buffer.from([0, 1, 2]));
    const binary = snapshotDirectory(a).hash;
    expect(binary).not.toBe(before);
    fs.renameSync(path.join(a, "image.bin"), path.join(a, "renamed.bin"));
    expect(snapshotDirectory(a).hash).not.toBe(binary);
    const renamed = snapshotDirectory(a).hash;
    fs.mkdirSync(path.join(a, "dist")); fs.writeFileSync(path.join(a, "dist", "run.js"), "bundled resource");
    expect(snapshotDirectory(a).hash).not.toBe(renamed);
  });
});
