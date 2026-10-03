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
