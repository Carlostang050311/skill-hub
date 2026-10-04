import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { hashDir } from "./github.js";
import { discoverSkills, loadOrigins, recordOrigin, saveOrigins, syncRepoCache } from "./github.js";
import { installSkill } from "./distribute.js";
import { makeTempDir, writeSkill } from "./test-utils.js";

const tempDirs: string[] = [];
function newTempDir(): string {
  const dir = makeTempDir();
  tempDirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function git(cwd: string, ...args: string[]): void {
  execFileSync("git", args, { cwd, stdio: "pipe" });
}

/** 造一个本地 bare 仓库当"远程"，含一个可演进的 skill */
function makeRemote(base: string): { remoteUrl: string; workDir: string } {
  const remoteUrl = path.join(base, "origin.git");
  git(base, "init", "--bare", "--initial-branch=main", remoteUrl);
  const workDir = path.join(base, "work");
  fs.mkdirSync(workDir, { recursive: true });
  writeSkill(workDir, ".", "---\nname: alpha\ndescription: alpha 第一版\n---\n" + "A".repeat(150), {
    "scripts/run.py": "print('v1')",
  });
  git(workDir, "init", "--initial-branch=main");
  git(workDir, "add", "-A");
  git(workDir, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-m", "v1");
  git(workDir, "remote", "add", "origin", remoteUrl);
  git(workDir, "push", "-q", "origin", "main");
  return { remoteUrl, workDir };
}

describe("hashDir", () => {
  it("同内容同指纹，改动内容指纹变，.git 不参与", () => {
    const dir = newTempDir();
    writeSkill(dir, "demo", "---\nname: demo\n---\n内容", { "a.txt": "1" });
    const h1 = hashDir(dir);
    expect(hashDir(dir)).toBe(h1);

    fs.writeFileSync(path.join(dir, "demo", "a.txt"), "2");
    expect(hashDir(dir)).not.toBe(h1);

    // .git 目录不参与指纹：加入与删除都不影响
    fs.rmSync(path.join(dir, "a.txt"), { force: true });
    fs.mkdirSync(path.join(dir, "demo", ".git"), { recursive: true });
    const withoutGit = hashDir(dir);
    fs.writeFileSync(path.join(dir, "demo", ".git", "HEAD"), "dirty");
    expect(hashDir(dir)).toBe(withoutGit);
  });
});

describe("syncRepoCache + discoverSkills + install（端到端）", () => {
  it("克隆→发现→安装→上游更新→检测→更新落地", () => {
    const base = newTempDir();
    const { remoteUrl, workDir } = makeRemote(base);
    const cacheRoot = path.join(base, "cache");
    const skillsDir = path.join(base, "skills");

    // 1. 首次克隆
    const first = syncRepoCache("test/alpha", cacheRoot, { urls: [remoteUrl] });
    expect(first.refreshed).toBe(true);
    expect(first.dir).toBe(path.join(cacheRoot, "test__alpha"));

    // 2. 发现 skill（skill 在仓库根，relativeId 为空串）
    const records = discoverSkills(first.dir);
    const alpha = records.find((r) => r.name === "alpha");
    expect(alpha).toBeDefined();
    expect(alpha?.relativeId).toBe("");

    // 3. 安装到目标目录
    const install = installSkill(records, "alpha", { to: { dir: skillsDir } });
    expect(install.status).toBe("installed");
    const installedDir = path.join(skillsDir, "alpha");
    expect(hashDir(installedDir)).toBe(hashDir(alpha.skillDir));

    // 4. 登记来源
    const originsFile = path.join(base, "origins.json");
    recordOrigin(originsFile, "alpha", {
      repo: "test/alpha",
      skillPath: alpha.relativeId,
      dirName: alpha.dirName,
      targetDir: skillsDir,
      dirHash: hashDir(installedDir),
    });
    expect(loadOrigins(originsFile)["alpha"]?.repo).toBe("test/alpha");

    // 5. 上游更新：改 description + 新增资源文件并推送
    fs.writeFileSync(path.join(workDir, "SKILL.md"), "---\nname: alpha\ndescription: alpha 第二版\n---\n" + "B".repeat(150));
    fs.writeFileSync(path.join(workDir, "scripts", "extra.py"), "print('v2')");
    git(workDir, "add", "-A");
    git(workDir, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-m", "v2");
    git(workDir, "push", "-q", "origin", "main");

    // 6. 同步缓存：指纹应变化
    const second = syncRepoCache("test/alpha", cacheRoot, { urls: [remoteUrl] });
    expect(second.refreshed).toBe(true);
    const fresh = discoverSkills(second.dir).find((r) => r.name === "alpha");
    expect(fresh?.description).toBe("alpha 第二版");
    expect(hashDir(fresh?.skillDir ?? "")).not.toBe(hashDir(installedDir));

    // 7. 应用更新
    const update = installSkill(discoverSkills(second.dir), "alpha", { to: { dir: skillsDir }, force: true });
    expect(update.status).toBe("installed");
    expect(fs.readFileSync(path.join(installedDir, "scripts", "extra.py"), "utf8")).toBe("print('v2')");
    expect(hashDir(installedDir)).toBe(hashDir(fresh.skillDir));
  });

  it("无变化时 refreshed=false", () => {
    const base = newTempDir();
    const { remoteUrl } = makeRemote(base);
    const cacheRoot = path.join(base, "cache");
    syncRepoCache("test/alpha", cacheRoot, { urls: [remoteUrl] });
    const second = syncRepoCache("test/alpha", cacheRoot, { urls: [remoteUrl] });
    expect(second.refreshed).toBe(false);
  });

  it("owner/repo 格式错误抛错", () => {
    expect(() => syncRepoCache("not-a-repo", newTempDir())).toThrow(/owner\/repo/);
  });
});

describe("origins 读写", () => {
  it("recordOrigin 追加且保存 load 往返", () => {
    const file = path.join(newTempDir(), "nested", "origins.json");
    saveOrigins(file, {});
    recordOrigin(file, "a", { repo: "o/r", skillPath: "a", targetDir: "/t", dirHash: "h1" });
    recordOrigin(file, "b", { repo: "o/r2", skillPath: "b", targetDir: "/t", dirHash: "h2" });
    const origins = loadOrigins(file);
    expect(Object.keys(origins)).toEqual(["a", "b"]);
    expect(origins["a"]?.installedAt).toBeTruthy();
  });

  it("文件不存在时返回空表", () => {
    expect(loadOrigins(path.join(newTempDir(), "nope.json"))).toEqual({});
  });
});
