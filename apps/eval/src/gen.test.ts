import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { SkillRecord } from "@skillhub/core";
import { buildGenChunks, parseGenResults, renderGenPrompt, scenarioToYaml, toGenItems, uncoveredSkills } from "./gen.js";
import { parse } from "yaml";

function rec(name: string, description: string, source = "agents"): SkillRecord {
  return {
    id: `${source}::${name}`,
    name,
    description,
    extraFrontmatter: {},
    source,
    sourceKind: "agents-global",
    skillPath: `/${name}/SKILL.md`,
    skillDir: `/${name}`,
    dirName: name,
    relativeId: name,
    files: [],
    bodyChars: 200,
    hash: `h-${name}`,
    quality: {
      hasName: true,
      nameMatchesDir: true,
      nameFormatOk: true,
      descriptionChars: description.length,
      descriptionTruncatedRisk: false,
      bodyChars: 200,
      bodyTooThin: false,
      missingResourceRefs: [],
      resourceFileCount: 0,
      warnings: [],
    },
    references: [],
    mentions: [],
    scannedAt: "now",
  };
}

describe("uncoveredSkills", () => {
  it("去重取 agents 优先并排除已覆盖", () => {
    const records = [
      rec("a", "desc a", "claude"),
      rec("a", "desc a2", "agents"),
      rec("b", "desc b"),
    ];
    const result = uncoveredSkills(records, new Set(["b"]));
    expect(result.map((r) => r.name)).toEqual(["a"]);
    expect(result[0]?.description).toBe("desc a2");
  });
});

describe("toGenItems", () => {
  it("description 过短时补正文片段", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gen-"));
    fs.writeFileSync(path.join(dir, "SKILL.md"), "---\nname: t\n---\n" + "正文内容".repeat(50));
    const r = rec("t", "短");
    r.skillPath = path.join(dir, "SKILL.md");
    const items = toGenItems([r]);
    expect(items[0]?.bodySnippet).toContain("正文内容");
    expect(items[0]?.bodySnippet.length).toBeLessThanOrEqual(600);
  });
});

describe("buildGenChunks / renderGenPrompt", () => {
  it("按块切分并包含清单与硬性要求", () => {
    const items = Array.from({ length: 25 }, (_, i) => ({ name: `s${i}`, description: "d", bodySnippet: "" }));
    const chunks = buildGenChunks(items, 10);
    expect(chunks.map((c) => c.skills.length)).toEqual([10, 10, 5]);
    const prompt = renderGenPrompt(chunks[0]);
    expect(prompt).toContain("s0");
    expect(prompt).toContain("should_not_trigger");
  });
});

describe("parseGenResults", () => {
  const validNames = new Set(["alpha", "beta"]);
  it("解析合法输出", () => {
    const raw = '{"scenarios":[{"skill":"alpha","should_trigger":["t1"],"should_not_trigger":["f1"]},{"skill":"beta","should_trigger":["t2"],"should_not_trigger":["f2"]}]}';
    const outcome = parseGenResults(raw, validNames);
    expect(outcome.generated).toHaveLength(2);
    expect(outcome.invalid).toHaveLength(0);
  });

  it("容忍围栏与杂文、过滤未知 skill 与空用例", () => {
    const raw = '好的：```json\n{"scenarios":[{"skill":"alpha","should_trigger":["t"],"should_not_trigger":["f"]},{"skill":"ghost","should_trigger":["t"],"should_not_trigger":["f"]},{"skill":"beta","should_trigger":[],"should_not_trigger":["f"]}]}\n```';
    const outcome = parseGenResults(raw, validNames);
    expect(outcome.generated.map((s) => s.skill)).toEqual(["alpha"]);
    expect(outcome.invalid.map((i) => i.skill)).toEqual(["ghost", "beta"]);
  });
});

describe("scenarioToYaml", () => {
  it("输出可被 YAML 解析回读，含生成标记", () => {
    const yaml = scenarioToYaml({ skill: "de:mo", shouldTrigger: ["用: 冒号", '引号"text"'], shouldNotTrigger: ["f"] });
    expect(yaml).toContain("# auto-generated");
    const parsed = parse(yaml) as { skill: string; should_trigger: string[] };
    expect(parsed.skill).toBe("de:mo");
    expect(parsed.should_trigger).toEqual(["用: 冒号", '引号"text"']);
  });
});
