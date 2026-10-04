import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { hashContent } from "./hash.js";
import { defaultRoots, scanAll } from "./scanner.js";
import {
  installSkill,
  isTargetKind,
  outdatedReport,
  packSkill,
  resolveSource,
  targetDirFor,
  uninstallSkill,
} from "./distribute.js";
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

function fixtureHome(): string {
  const home = newTempDir();
  writeSkill(home, ".agents/skills/toolkit", "---\nname: toolkit\ndescription: 工具箱\n---\n" + "A".repeat(150), {
    "scripts/run.py": "print()",
  });
  writeSkill(home, ".claude/skills/oldie", "---\nname: oldie\ndescription: 旧版内容\n---\n" + "OLD".repeat(100));
  writeSkill(home, ".codex/skills/oldie", "---\nname: oldie\ndescription: 新版内容\n---\n" + "NEW".repeat(100));
  return home;
}

describe("targetDirFor / isTargetKind", () => {
  it("三种目标映射到各自目录", () => {
    const home = newTempDir();
    expect(targetDirFor("agents", home)).toBe(path.join(home, ".agents", "skills"));
    expect(targetDirFor("claude", home)).toBe(path.join(home, ".claude", "skills"));
    expect(targetDirFor("codex", home)).toBe(path.join(home, ".codex", "skills"));
  });

  it("isTargetKind 判定", () => {
    expect(isTargetKind("claude")).toBe(true);
    expect(isTargetKind("plugin-cache")).toBe(false);
  });
});

describe("resolveSource", () => {
  it("默认按 agents > claude > codex 优先", () => {
    const records = scanAll(defaultRoots(fixtureHome())).skills;
    expect(resolveSource(records, "oldie")?.source).toBe("claude");
  });

  it("指定 from 时精确匹配，不存在返回 null", () => {
    const records = scanAll(defaultRoots(fixtureHome())).skills;
    expect(resolveSource(records, "oldie", "codex")?.source).toBe("codex");
    expect(resolveSource(records, "oldie", "agents")).toBeNull();
    expect(resolveSource(records, "ghost")).toBeNull();
  });
});

describe("installSkill", () => {
  it("全新安装：复制目录并保留资源文件，扫描器能从目标目录发现", () => {
    const home = fixtureHome();
    const records = scanAll(defaultRoots(home)).skills;
    const result = installSkill(records, "toolkit", { to: "claude", home });
    expect(result.status).toBe("installed");
    expect(result.filesCopied).toBe(2);
    expect(fs.existsSync(path.join(targetDirFor("claude", home), "toolkit", "scripts", "run.py"))).toBe(true);

    const rescanned = scanAll(defaultRoots(home)).skills;
    const inClaude = rescanned.find((r) => r.name === "toolkit" && r.source === "claude");
    expect(inClaude).toBeDefined();
    expect(inClaude?.hash).toBe(records.find((r) => r.name === "toolkit")?.hash);
  });

  it("目标内容一致时报 identical 不重复复制", () => {
    const home = fixtureHome();
    const records = scanAll(defaultRoots(home)).skills;
    installSkill(records, "toolkit", { to: "claude", home });
    const again = installSkill(scanAll(defaultRoots(home)).skills, "toolkit", { to: "claude", home });
    expect(again.status).toBe("identical");
    expect(again.filesCopied).toBe(0);
  });

  it("目标已有不同内容：dryRun 不落盘、默认 conflict、force 覆盖", () => {
    const home = fixtureHome();
    const first = installSkill(scanAll(defaultRoots(home)).skills, "oldie", { to: "agents", home, from: "claude" });
    expect(first.status).toBe("installed");

    const records = scanAll(defaultRoots(home)).skills;
    const dry = installSkill(records, "oldie", { to: "agents", home, from: "codex", dryRun: true });
    expect(dry.status).toBe("conflict");
    expect(dry.dryRun).toBe(true);
    expect(fs.readFileSync(path.join(targetDirFor("agents", home), "oldie", "SKILL.md"), "utf8")).toContain("旧版内容");

    const refused = installSkill(records, "oldie", { to: "agents", home, from: "codex" });
    expect(refused.status).toBe("conflict");

    const forced = installSkill(records, "oldie", { to: "agents", home, from: "codex", force: true });
    expect(forced.status).toBe("installed");
    const rescanned = scanAll(defaultRoots(home)).skills.find((r) => r.name === "oldie" && r.source === "agents");
    expect(rescanned?.description).toBe("新版内容");
  });

  it("同名目录名与 skill 名不一致时沿用来源目录名", () => {
    const home = newTempDir();
    writeSkill(home, ".agents/skills/dir-name", "---\nname: skill-name\ndescription: 目录名不同\n---\n" + "X".repeat(150));
    const records = scanAll(defaultRoots(home)).skills;
    const result = installSkill(records, "skill-name", { to: "claude", home });
    expect(result.targetPath.endsWith("dir-name")).toBe(true);
  });
});

describe("uninstallSkill", () => {
  it("删除后目标目录不再含该 skill", () => {
    const home = fixtureHome();
    const records = scanAll(defaultRoots(home)).skills;
    installSkill(records, "toolkit", { to: "claude", home });
    expect(uninstallSkill(scanAll(defaultRoots(home)).skills, "toolkit", "claude", home)).toBe(true);
    expect(fs.existsSync(path.join(targetDirFor("claude", home), "toolkit"))).toBe(false);
    expect(uninstallSkill(scanAll(defaultRoots(home)).skills, "toolkit", "claude", home)).toBe(false);
  });
});

describe("outdatedReport", () => {
  it("内容漂移组按 mtime 找最新并列出落后副本", () => {
    const home = fixtureHome();
    // 把 claude 副本 mtime 调旧，模拟"codex 上改过、claude 没同步"（相对时间，避免日期炸弹）
    const stale = new Date(Date.now() - 86_400_000);
    fs.utimesSync(path.join(home, ".claude", "skills", "oldie", "SKILL.md"), stale, stale);
    const records = scanAll(defaultRoots(home)).skills;
    const entries = outdatedReport(records);
    const oldie = entries.find((e) => e.name === "oldie");
    expect(oldie?.newest.source).toBe("codex");
    expect(oldie?.lagging.map((l) => l.source)).toEqual(["claude"]);
  });
});

describe("packSkill", () => {
  it("导出干净目录 + manifest，hash 与来源一致", () => {
    const home = fixtureHome();
    const records = scanAll(defaultRoots(home)).skills;
    const outRoot = newTempDir();
    const result = packSkill(records, "toolkit", outRoot);
    expect(fs.existsSync(result.manifestPath)).toBe(true);
    const manifest = JSON.parse(fs.readFileSync(result.manifestPath, "utf8")) as { name: string; hash: string };
    expect(manifest.name).toBe("toolkit");
    expect(manifest.hash).toBe(records.find((r) => r.name === "toolkit")?.hash);
    // 打包产物本身可被扫描器识别
    const packed = scanAll([{ source: "packed", path: outRoot, sourceKind: "custom", maxDepth: 3 }]).skills;
    expect(packed.map((s) => s.name)).toContain("toolkit");
  });
});
