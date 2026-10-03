import fs from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { groupByName } from "./groups.js";
import { scanAll, defaultRoots } from "./scanner.js";
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

describe("scanAll", () => {
  it("扫描扁平目录、插件缓存目录与缺失目录", () => {
    const home = newTempDir();
    writeSkill(home, ".agents/skills/alpha", "---\nname: alpha\ndescription: alpha skill\n---\n" + "A".repeat(150), {
      "scripts/run.py": "print()",
    });
    writeSkill(home, ".agents/skills/beta", "---\ndescription: 只有描述没有 name\n---\n" + "B".repeat(150));
    writeSkill(home, ".claude/skills/alpha", "---\nname: alpha\ndescription: 改过的版本\n---\n" + "C".repeat(150));
    writeSkill(
      home,
      ".zcode/cli/plugins/cache/zcode-plugins-official/documents/0.1.7/skills/docx",
      "---\nname: docx\ndescription: 文档技能\n---\n" + "D".repeat(150),
    );

    const result = scanAll(defaultRoots(home));
    const bySource = Object.fromEntries(result.roots.map((r) => [r.source, r]));
    expect(bySource["agents"]?.count).toBe(2);
    expect(bySource["claude"]?.count).toBe(1);
    expect(bySource["zcode-plugins"]?.count).toBe(1);
    expect(bySource["codex"]?.exists).toBe(false);
    expect(result.skills).toHaveLength(4);

    const docx = result.skills.find((s) => s.name === "docx");
    expect(docx?.sourceKind).toBe("plugin-cache");
    expect(docx?.version).toBe("0.1.7");

    const beta = result.skills.find((s) => s.name === "beta");
    expect(beta?.quality.hasName).toBe(false);
    expect(beta?.id).toBe("agents::beta");
    expect(result.skills.every((s) => s.skillPath.includes("SKILL.md"))).toBe(true);

    const alphaAgents = result.skills.find((s) => s.id === "agents::alpha");
    expect(alphaAgents?.files).toContain("scripts/run.py");
  });

  it("正文按词边界提及库内其他 skill（≥4 字符）", () => {
    const home = newTempDir();
    writeSkill(
      home,
      ".agents/skills/writer",
      "---\nname: writer\ndescription: 写作\n---\n配合 test-driven-development 使用，也参考 web-gui-tester。不是 qa，也不是 pptx 短词。test-driven-development 再提一次去重。\n",
    );
    writeSkill(home, ".agents/skills/test-driven-development", "---\nname: test-driven-development\ndescription: tdd\n---\n" + "T".repeat(150));
    writeSkill(home, ".agents/skills/web-gui-tester", "---\nname: web-gui-tester\ndescription: gui\n---\n" + "W".repeat(150));
    writeSkill(home, ".agents/skills/unrelated", "---\nname: unrelated\ndescription: x\n---\n" + "U".repeat(150));

    const result = scanAll(defaultRoots(home));
    const writer = result.skills.find((s) => s.name === "writer");
    expect(writer?.mentions).toEqual(["test-driven-development", "web-gui-tester"]);
    const tdd = result.skills.find((s) => s.name === "test-driven-development");
    expect(tdd?.mentions).toEqual([]);
  });

  it("同名跨目录且内容漂移可被分组发现", () => {
    const home = newTempDir();
    writeSkill(home, ".agents/skills/same", "---\nname: same\ndescription: v1\n---\n" + "X".repeat(150));
    writeSkill(home, ".claude/skills/same", "---\nname: same\ndescription: v1\n---\n" + "X".repeat(150));
    writeSkill(home, ".agents/skills/diverged", "---\nname: diverged\ndescription: a\n---\n" + "Y".repeat(150));
    writeSkill(home, ".claude/skills/diverged", "---\nname: diverged\ndescription: b\n---\n" + "Z".repeat(150));

    const result = scanAll(defaultRoots(home));
    const groups = groupByName(result.skills);
    const same = groups.find((g) => g.name === "same");
    const diverged = groups.find((g) => g.name === "diverged");
    expect(same?.occurrences).toHaveLength(2);
    expect(same?.identical).toBe(true);
    expect(diverged?.identical).toBe(false);
    expect(diverged?.hashes).toHaveLength(2);
  });

  it("解析失败的 skill 计入 failed 不阻断扫描", () => {
    const home = newTempDir();
    // 非法 YAML 让 frontmatter 解析抛错；Windows 下 chmod 不可靠，不用权限注入
    writeSkill(home, ".agents/skills/broken", "---\nname: [unclosed\n---\n正文");
    writeSkill(home, ".agents/skills/ok", "---\nname: ok\ndescription: d\n---\n" + "K".repeat(150));

    const result = scanAll(defaultRoots(home));
    const agents = result.roots.find((r) => r.source === "agents");
    expect(agents?.failed).toBe(1);
    expect(agents?.count).toBe(1);
    expect(agents?.failedFiles[0]).toContain("broken");
  });
});
