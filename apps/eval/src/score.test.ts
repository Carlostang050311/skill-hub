import { describe, expect, it } from "vitest";
import { hashContent, type SkillRecord } from "@skillhub/core";
import type { EvalJob, JobResult } from "./types.js";
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

  it("结果缺失计入 errors，不发布完整总分", () => {
    const partial = scoreRun([sc], [rec("demo")], jobs, [results[0]], "t", "zcode");
    const r = partial.results[0];
    expect(r?.errors).toBe(3);
    expect(r?.triggerTotal).toBe(0);
    expect(r?.triggerScore).toBeNull();
    expect(r?.overall).toBeNull();
    expect(r?.status).toBe("incomplete");
    expect(r?.completionRate).toBe(25);
    expect(partial.avgOverall).toBeNull();
  });

  it("非布尔 trigger 不冒充负例正确，超出范围的清晰度不被截成高分", () => {
    const invalid = results.map((r) => r.id.includes("clarity") ? { ...r, raw: '{"consistency": 50, "actionability": 5, "boundedness": 5}' } : { ...r, raw: '{}' });
    const r = scoreRun([sc], [rec("demo")], jobs, invalid, "t", "api").results[0];
    expect(r?.overall).toBeNull();
    expect(r?.errors).toBe(4);
    expect(r?.completedJobs).toBe(0);
  });

  it("成绩绑定作业时的 skill 和用例指纹，变更后标记 stale", () => {
    const bound = jobs.map((j) => ({ ...j, skillHash: "h-demo", scenarioHash: hashContent(JSON.stringify(sc)) }));
    const complete = scoreRun([sc], [rec("demo")], bound, results, "t", "api").results[0];
    expect(complete?.status).toBe("complete");
    expect(complete?.skillHash).toBe("h-demo");
    const changed = { ...rec("demo"), hash: "new" };
    expect(scoreRun([sc], [changed], bound, results, "t", "api").results[0]?.status).toBe("stale");
    expect(scoreRun([{ ...sc, shouldTrigger: ["changed", "t2"] }], [rec("demo")], bound, results, "t", "api").results[0]?.overall).toBeNull();
  });

  it("缺少作业文件、重复作业或 HTTP 错误不能生成完整评分", () => {
    const duplicated = [jobs[0]!, jobs[1]!, jobs[1]!, jobs[3]!];
    expect(scoreRun([sc], [rec("demo")], duplicated, results, "t", "api").results[0]?.overall).toBeNull();
    expect(scoreRun([sc], [rec("demo")], [], [], "t", "api").results[0]?.completionRate).toBe(0);
    const failed = results.map((r) => ({ ...r, error: "HTTP 429" }));
    const r = scoreRun([sc], [rec("demo")], jobs, failed, "t", "api").results[0];
    expect(r?.errors).toBe(4);
    expect(r?.overall).toBeNull();
    expect(r?.skillHash).toBeUndefined();
    expect(scoreRun([sc], [rec("demo")], [], [], "t", "api").results[0]?.errors).toBe(4);
    const swapped = jobs.map((j) => j.id === "clarity:demo" ? { ...j, type: "trigger" as const, expectTrigger: true } : j);
    expect(scoreRun([sc], [rec("demo")], swapped, results, "t", "api").results[0]?.overall).toBeNull();
  });
  it("指定副本的静态评分和版本校验不借用默认副本", () => {
    const agents = rec("demo");
    const claude = { ...rec("demo", ["thin"]), id: "claude::demo", source: "claude", hash: "claude-hash" };
    const bound = jobs.map((j) => ({ ...j, skillId: claude.id, skillHash: claude.hash, scenarioHash: hashContent(JSON.stringify(sc)) }));
    const row = scoreRun([sc], [agents, claude], bound, results, "t", "api").results[0];
    expect(row?.source).toBe("claude");
    expect(row?.staticScore).toBe(90);
    expect(row?.status).toBe("complete");
    expect(scoreRun([sc], [agents, { ...claude, hash: "changed" }], bound, results, "t", "api").results[0]?.status).toBe("stale");
  });
  it("多技能任务的副本或用例消失，仍保留原计划分母和失败行", () => {
    const second = { ...sc, skill: "other" };
    const secondJobs = jobs.map((j) => ({ ...j, skill: "other", id: j.id.replace("demo", "other"), skillId: "agents::other", scenario: second }));
    const secondResults = results.map((r) => ({ ...r, id: r.id.replace("demo", "other") }));
    const allJobs = [...jobs, ...secondJobs]; const allResults = [...results, ...secondResults];
    const missingCopy = scoreRun([sc, second], [rec("demo")], allJobs, allResults, "t", "api");
    expect(missingCopy.results).toHaveLength(2);
    expect(missingCopy.expectedJobs).toBe(8);
    expect(missingCopy.results[1]?.status).toBe("stale");
    expect(missingCopy.errors).toBe(1);
    const missingCases = scoreRun([sc], [rec("demo"), rec("other")], allJobs, allResults, "t", "api");
    expect(missingCases.expectedJobs).toBe(8);
    expect(missingCases.results[1]?.overall).toBeNull();
    expect(missingCases.results[1]?.status).toBe("stale");
  });
});
