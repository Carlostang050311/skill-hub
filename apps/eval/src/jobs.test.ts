import { describe, expect, it } from "vitest";
import type { SkillRecord } from "@skillhub/core";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildJobs, parseModelJson, parseResultsFile, pickPreferred } from "./jobs.js";
import type { Scenario } from "./types.js";

function rec(name: string, source = "agents", idSuffix = ""): SkillRecord {
  return {
    id: `${source}::${name}${idSuffix}`,
    name,
    description: `${name} 的描述`,
    extraFrontmatter: {},
    source,
    sourceKind: "agents-global",
    skillPath: `/skills/${name}/SKILL.md`,
    skillDir: `/skills/${name}`,
    dirName: name,
    relativeId: name,
    files: [],
    bodyChars: 200,
    hash: `h-${name}-${source}`,
    quality: {
      hasName: true,
      nameMatchesDir: true,
      nameFormatOk: true,
      descriptionChars: 10,
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

function makeRealSkill(body: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), "skillhub-jobs-"));
  const skillDir = path.join(dir, "demo");
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(path.join(skillDir, "SKILL.md"), `---\nname: demo\ndescription: 测试\n---\n${body}`);
  return path.join(skillDir, "SKILL.md");
}

const sc: Scenario = {
  skill: "demo",
  shouldTrigger: ["用 demo 帮我做事", "再来一次 demo"],
  shouldNotTrigger: ["做无关的事"],
};

describe("pickPreferred", () => {
  it("同名优先 agents 来源", () => {
    const picked = pickPreferred([rec("x", "claude", "-c"), rec("x", "agents", "-a")]);
    expect(picked.get("x")?.id).toBe("agents::x-a");
  });
});

describe("buildJobs", () => {
  it("每个 skill 生成 1 条 clarity + 每用例 1 条 trigger，期望值正确", () => {
    const demo = rec("demo");
    demo.skillPath = makeRealSkill("# Demo 技能正文\n第一步做什么。");
    const { jobs, skipped } = buildJobs([sc], [demo]);
    expect(skipped).toEqual([]);
    const clarity = jobs.filter((j) => j.type === "clarity");
    const trigger = jobs.filter((j) => j.type === "trigger");
    expect(clarity).toHaveLength(1);
    expect(trigger).toHaveLength(3);
    expect(trigger[0]?.expectTrigger).toBe(true);
    expect(trigger[2]?.expectTrigger).toBe(false);
    expect(trigger[0]?.messages[0]?.content).toContain("用 demo 帮我做事");
    expect(clarity[0]?.messages[0]?.content).toContain("Demo 技能正文");
  });

  it("库中不存在的 skill 进 skipped", () => {
    const { jobs, skipped } = buildJobs([sc], [rec("other")]);
    expect(skipped).toEqual(["demo"]);
    expect(jobs).toHaveLength(0);
  });
});

describe("parseModelJson", () => {
  it("容忍代码围栏与前后杂文", () => {
    expect(parseModelJson('```json\n{"trigger": true}\n```')).toEqual({ trigger: true });
    expect(parseModelJson('好的，结论如下：{"trigger": false, "reason": "无关"} 以上。')).toEqual({
      trigger: false,
      reason: "无关",
    });
    expect(parseModelJson("完全不是 JSON")).toBeNull();
    expect(parseModelJson('{"trigger": true')).toBeNull();
  });
});

describe("parseResultsFile", () => {
  it("逐行解析并跳过坏行", () => {
    const results = parseResultsFile('{"id":"a","raw":"{}"}\n坏行\n\n{"id":"b","raw":"{}"}\n{"broken": 1}\n');
    expect(results.map((r) => r.id)).toEqual(["a", "b"]);
  });
});
