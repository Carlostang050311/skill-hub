import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { SkillRecord } from "@skillhub/core";
import { ensureSandbox, parseExecReport, parseExecSpec, renderExecutorPrompt, renderJudgePrompt, scoreExec, type ExecSpec } from "./exec.js";
import { loadScenarios } from "./scenario.js";

function rec(name: string, dir: string): SkillRecord {
  return {
    id: `agents::${name}`,
    name,
    description: "d",
    extraFrontmatter: {},
    source: "agents",
    sourceKind: "agents-global",
    skillPath: path.join(dir, "SKILL.md"),
    skillDir: dir,
    dirName: name,
    relativeId: name,
    files: [],
    bodyChars: 200,
    hash: "h",
    quality: {
      hasName: true,
      nameMatchesDir: true,
      nameFormatOk: true,
      descriptionChars: 1,
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

const YAML = `skill: demo\nshould_trigger:\n  - t\nshould_not_trigger:\n  - f\nexecute:\n  task: 写一个报告\n  artifacts:\n    - report.md\n  rubric:\n    - 报告存在且非空\n    - 引用了数据来源\n`;

describe("parseExecSpec", () => {
  it("解析 execute 块", () => {
    const scenarios = loadScenariosFromText(YAML);
    const spec = parseExecSpec(scenarios[0]);
    expect(spec?.task).toBe("写一个报告");
    expect(spec?.rubric).toHaveLength(2);
    expect(spec?.artifacts).toEqual(["report.md"]);
  });

  it("无 execute 块返回 null", () => {
    const scenarios = loadScenariosFromText("skill: demo\nshould_trigger:\n  - t\nshould_not_trigger:\n  - f\n");
    expect(parseExecSpec(scenarios[0])).toBeNull();
  });

  it("缺 rubric 抛错", () => {
    expect(() => parseExecSpec(loadScenariosFromText("skill: demo\nshould_trigger:\n  - t\nshould_not_trigger:\n  - f\nexecute:\n  task: x\n")[0])).toThrow(/rubric/);
  });
});

function loadScenariosFromText(text: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "scen-"));
  fs.writeFileSync(path.join(dir, "s.yaml"), text);
  return loadScenarios(dir);
}

describe("执行→评审 两阶段", () => {
  it("parseExecReport 解析执行者报告", () => {
    const report = parseExecReport("demo", "/sb", '{"artifacts":["report.md"],"summary":"完成","rubric":[{"item":"报告存在且非空","pass":true,"evidence":"3KB"}]}');
    expect(report.artifacts).toEqual(["report.md"]);
    expect(report.rubric[0]?.pass).toBe(true);
  });

  it("parseExecReport 容忍坏 JSON", () => {
    const report = parseExecReport("demo", "/sb", "完全不是 JSON");
    expect(report.parseError).toBeTruthy();
    expect(report.rubric).toHaveLength(0);
  });

  it("scoreExec 按评审结果算通过率并收集问题", () => {
    const spec: ExecSpec = { task: "t", artifacts: [], rubric: ["r1", "r2"] };
    const judgeRaw = '{"rubric":[{"item":"r1","pass":true,"evidence":"在"},{"item":"r2","pass":false,"evidence":"缺失"}],"overall_comment":"一半"}';
    const result = scoreExec(spec, judgeRaw);
    expect(result.score).toBe(50);
    expect(result.rubricPassed).toBe(1);
    expect(result.issues).toHaveLength(1);
  });

  it("ensureSandbox 创建沙箱且拒绝越界", () => {
    const root = fs.mkdtempSync(path.join(process.cwd(), ".skillhub-test-sb-"));
    const dir = ensureSandbox(root, "demo");
    expect(fs.existsSync(dir)).toBe(true);
    expect(() => ensureSandbox(root, "../escape")).toThrow(/越界/);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("执行者提示词与评审提示词包含关键要素", () => {
    const spec: ExecSpec = { task: "写报告", artifacts: ["report.md"], rubric: ["非空"] };
    const execPrompt = renderExecutorPrompt({ skillPath: "/skills/demo/SKILL.md", sandboxDir: "/sb/demo", spec });
    expect(execPrompt).toContain("/skills/demo/SKILL.md");
    expect(execPrompt).toContain("写报告");
    expect(execPrompt).toContain("非空");

    const report = parseExecReport("demo", "/sb/demo", '{"summary":"done","rubric":[]}');
    const judgePrompt = renderJudgePrompt({ skill: "demo", spec, report, fileListing: "report.md" });
    expect(judgePrompt).toContain("done");
    expect(judgePrompt).toContain("report.md");
    expect(judgePrompt).toContain("独立复核");
  });
});
