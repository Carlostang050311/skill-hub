import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { main } from "./cli.js";
import { makeTempDir, writeSkill } from "../../core/src/test-utils.js";

let home: string;
let logs: string[];

beforeEach(() => {
  home = makeTempDir("skillhub-cli-");
  logs = [];
  vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
    logs.push(args.map(String).join(" "));
  });
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    logs.push(args.map(String).join(" "));
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  process.exitCode = 0;
  fs.rmSync(home, { recursive: true, force: true });
});

function writeFixture(): void {
  writeSkill(home, ".agents/skills/alpha", "---\nname: alpha\ndescription: alpha 测试技能\n---\n" + "A".repeat(150));
  writeSkill(home, ".agents/skills/beta", "---\nname: beta\ndescription: beta 搜索关键词\n---\n" + "B".repeat(150));
  writeSkill(home, ".claude/skills/alpha", "---\nname: alpha\ndescription: 另一个 alpha\n---\n" + "C".repeat(150));
}

async function runJson(args: string[]): Promise<unknown> {
  logs = [];
  await main([...args, "--json", "--home", home]);
  return JSON.parse(logs.join("\n")) as unknown;
}

describe("CLI", () => {
  it("CLI 显式恢复缺失目标，且空目标预期与内容指纹选项互斥", async () => {
    writeFixture();
    const target = path.join(home, ".claude", "skills", "alpha");
    const original = fs.readFileSync(path.join(target, "SKILL.md"), "utf8");
    const installed = await runJson(["install", "alpha", "--to", "claude", "--from", "agents", "--force"]) as { backupId: string };
    fs.renameSync(target, path.join(home, "archived-alpha"));
    await expect(runJson(["restore", installed.backupId])).rejects.toThrow(/当前内容已变化/);
    await expect(runJson(["restore", installed.backupId, "--target-missing", "--expected-hash", "hash"])).rejects.toThrow(/互斥/);
    await runJson(["restore", installed.backupId, "--target-missing"]);
    expect(fs.readFileSync(path.join(target, "SKILL.md"), "utf8")).toBe(original);
    await expect(runJson(["restore", installed.backupId, "--target-missing"])).rejects.toThrow(/当前内容已变化/);
  });
  it("差异预览、修复与备份恢复覆盖完整目录且保留原件", async () => {
    writeFixture();
    const diff = await runJson(["diff", "alpha", "--to", "claude", "--from", "agents"]) as { differences: Array<{ path: string }> };
    expect(diff.differences.map((f) => f.path)).toContain("SKILL.md");
    const original = fs.readFileSync(path.join(home, ".claude", "skills", "alpha", "SKILL.md"), "utf8");
    const file = path.join(home, "edit.md"); fs.writeFileSync(file, original + "\n核查输入并提供验收记录。".repeat(8));
    const preview = await runJson(["repair-preview", "alpha", "--from", "claude", "--file", file]) as { expectedHash: string };
    expect(fs.readFileSync(path.join(home, ".claude", "skills", "alpha", "SKILL.md"), "utf8")).toBe(original);
    const applied = await runJson(["repair", "alpha", "--from", "claude", "--file", file, "--expected-hash", preview.expectedHash]) as { backupId: string };
    expect((await runJson(["backups"]) as Array<{ id: string }>).some((b) => b.id === applied.backupId)).toBe(true);
    await runJson(["restore", applied.backupId]);
    expect(fs.readFileSync(path.join(home, ".claude", "skills", "alpha", "SKILL.md"), "utf8")).toBe(original);
  });
  it("list 返回全部 skill 且可按来源过滤", async () => {
    writeFixture();
    const all = (await runJson(["list"])) as Array<{ name: string; source: string }>;
    expect(all).toHaveLength(3);
    expect(all.map((s) => s.name)).toEqual(["alpha", "alpha", "beta"]);

    const agents = (await runJson(["list", "--source", "agents"])) as Array<{ name: string }>;
    expect(agents).toHaveLength(2);
    expect(agents.every((s) => s.name.length > 0)).toBe(true);
  });

  it("search 命中名称与描述", async () => {
    writeFixture();
    const hits = (await runJson(["search", "beta"])) as Array<{ name: string; score: number }>;
    expect(hits).toHaveLength(1);
    expect(hits[0]?.name).toBe("beta");
    expect((hits[0]?.score ?? 0) >= 3).toBe(true);
  });

  it("show 返回详情与正文，未知名字退出码 1", async () => {
    writeFixture();
    const detail = (await runJson(["show", "alpha"])) as Array<{
      name: string;
      skillPath: string;
      body?: string;
      warnings: string[];
    }>;
    expect(detail).toHaveLength(2);
    expect(detail[0]?.skillPath).toContain("SKILL.md");
    expect(detail[0]?.body).toContain("AAAA");

    logs = [];
    await main(["show", "no-such-thing", "--json", "--home", home]);
    expect(process.exitCode).toBe(1);
    expect(logs.some((l) => l.includes("找不到"))).toBe(true);
  });

  it("scan 摘要包含根目录统计与漂移提示", async () => {
    writeFixture();
    logs = [];
    await main(["scan", "--home", home]);
    const text = logs.join("\n");
    expect(text).toContain("共扫描到 3 个 skill");
    expect(text).toContain("[agents]");
    expect(text).toContain("内容漂移的同名 skill：alpha");
  });

  it("scan JSON 返回 scanRunId，并写入隔离库存数据库", async () => {
    writeFixture();
    const result = await runJson(["scan"]) as { scanRunId: string; skills: unknown[] };
    expect(result.scanRunId).toMatch(/^[a-f0-9-]{36}$/);
    expect(result.skills).toHaveLength(3);
    expect(fs.existsSync(path.join(home, ".skillhub", "inventory.db"))).toBe(true);
  });

  it("roots 列出目录与计数", async () => {
    writeFixture();
    const roots = (await runJson(["roots"])) as Array<{ source: string; count: number; exists: boolean }>;
    const agents = roots.find((r) => r.source === "agents");
    expect(agents?.count).toBe(2);
    expect(agents?.exists).toBe(true);
  });

  it("--only-custom 只扫指定目录", async () => {
    writeFixture();
    const customDir = path.resolve(home, "extra");
    writeSkill(customDir, "gamma", "---\nname: gamma\ndescription: 自定义目录\n---\n" + "G".repeat(150));
    const skills = (await runJson(["list", "--only-custom", "--root", customDir])) as Array<{ name: string }>;
    expect(skills.map((s) => s.name)).toEqual(["gamma"]);
  });
});
