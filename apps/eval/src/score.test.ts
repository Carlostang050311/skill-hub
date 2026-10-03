import { describe, expect, it } from "vitest";
import type { EvalJob, JobResult, SkillRecord } from "@skillhub/core";
import { scoreRun, staticScoreOf } from "./score.js";
import type { Scenario } from "./types.js";

function rec(name: string, warnings: string[] = []): SkillRecord {
  return {
    id: `agents::${name}`,
    name,
    description: `${name} 的描述`,
    extraFrontmatter: {},
    source: "agents",
    sourceKind: "agents-global",
    skillPath: `/skills/${name}/SKILL.md`,
    skillDir: `/skills/${name}`,
    dirName: name,
    relativeId: name,
    files: [],
    bodyChars: 200,
    hash: `h-${name}`,
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
      warnings,
    },
    references: [],
    mentions: [],
    scannedAt: "now",
  };
}

const sc: Scenario = { skill: "demo", shouldTrigger: ["t1", "t2"], shouldNotTrigger: ["f1"] };

const jobs: EvalJob[] = [
  { id: "clarity:demo", type: "clarity", skill: "demo", messages: [] },
  { id: "trigger:demo:0", type: "trigger", skill: "demo", expectTrigger: true, messages: [] },
  { id: "trigger:demo:1", type: "trigger", skill: "demo", expectTrigger: true, messages: [] },
  { id: "trigger:demo:2", type: "trigger", skill: "demo", expectTrigger: false, messages: [] },
];

const results: JobResult[] = [
  { id: "clarity:demo", raw: '{"consistency": 4, "actionability": 5, "boundedness": 3, "issues": ["小问题"]}' },
  { id: "trigger:demo:0", raw: '{"trigger": true}' },
  { id: "trigger:demo:1", raw: '```json\n{"trigger": false}\n```' },
  { id: "trigger:demo:2", raw: '{"trigger": true, "reason": "误触发"}' },
];

describe("staticScoreOf", () => {
  it("每条警告扣 10 分下限 0", () => {
    expect(staticScoreOf(rec("a")).score).toBe(100);
    expect(staticScoreOf(rec("b", ["w1", "w2"])).score).toBe(80);
    expect(staticScoreOf(rec("c", Array(15).fill("w"))).score).toBe(0);
  });
});

describe("scoreRun", () => {
  const report = scoreRun([sc], [rec("demo", ["一个警告"])], jobs, results, "2026-01-01T00:00:00Z", "zcode", "test-model");

  it("触发分：3 例中仅第 1 例正确，误触发计 1", () => {
    const r = report.results[0];
    expect(r?.triggerCorrect).toBe(1);
    expect(r?.triggerTotal).toBe(3);
    expect(r?.falsePositives).toBe(1);
    expect(r?.triggerScore).toBe(33);
  });

  it("清晰度分：(4+5+3)/15*100 = 80，issues 被收集", () => {
    const r = report.results[0];
    expect(r?.clarityScore).toBe(80);
    expect(r?.consistency).toBe(4);
    expect(r?.issues).toEqual(["小问题"]);
  });

  it("静态分 90（一条警告），overall = 0.4*33+0.3*80+0.3*90 = 64", () => {
    const r = report.results[0];
    expect(r?.staticScore).toBe(90);
    expect(r?.overall).toBe(64);
  });

  it("运行级平均分存在且标注了后端与模型", () => {
    expect(report.backend).toBe("zcode");
    expect(report.model).toBe("test-model");
    expect(report.avgOverall).toBe(64);
  });

  it("结果缺失或解析失败计入 errors 不计入 total；overall 用可用层权重再归一", () => {
    const partial = scoreRun([sc], [rec("demo")], jobs, [results[0]], "t", "zcode");
    const r = partial.results[0];
    expect(r?.errors).toBe(3);
    expect(r?.triggerTotal).toBe(0);
    expect(r?.triggerScore).toBeNull();
    // 只有清晰度 80 与静态 100 两层：(0.3*80 + 0.3*100) / 0.6 = 90
    expect(r?.overall).toBe(90);
  });
});
