import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { inspectArtifacts, parseArtifactChecks, validateArtifacts } from "./artifacts.js";
import { renderJudgePrompt, scoreExec, type ExecSpec } from "./exec.js";

const dirs: string[] = [];
function sandbox() { const dir = fs.mkdtempSync(path.join(os.tmpdir(), "skillhub-artifacts-")); dirs.push(dir); return dir; }
afterEach(() => { for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });

describe("真实产物验收", () => {
  it("不存在、空文件、坏 JSON 和缺少关键内容均拒绝通过", () => {
    const root = sandbox();
    fs.writeFileSync(path.join(root, "empty.md"), "");
    fs.writeFileSync(path.join(root, "broken.json"), "{bad");
    fs.writeFileSync(path.join(root, "report.md"), "数据报告");
    const checks = validateArtifacts(root, ["missing.md", "empty.md"], [{ type: "json", file: "broken.json" }, { type: "contains", file: "report.md", value: "来源" }]);
    expect(checks.every((c) => !c.pass)).toBe(true);
  });
  it("读取真实内容并把证据交给独立评审，产物通过后才接受满分", () => {
    const root = sandbox();
    fs.writeFileSync(path.join(root, "report.json"), '{"source":"真实数据来源"}');
    const spec: ExecSpec = { task: "报告", artifacts: ["report.json"], rubric: ["有效报告"], checks: [{ type: "json", file: "report.json" }, { type: "contains", file: "report.json", value: "来源" }] };
    const judge = '{"rubric":[{"item":"有效报告","pass":true}]}';
    const result = scoreExec(spec, judge, root);
    expect(result.score).toBe(100);
    expect(result.accepted).toBe(true);
    expect(result.checks).toHaveLength(3);
    const prompt = renderJudgePrompt({ skill: "report", spec, report: { skill: "report", sandboxDir: root, artifacts: ["report.json"], summary: "done", rubric: [], raw: "" }, fileListing: "report.json" });
    expect(prompt).toContain("真实数据来源");
    expect(prompt).toContain("真实产物证据");
  });
  it("不存在的产物不能被模型满分、自述或重复评分项掩盖", () => {
    const root = sandbox();
    const spec: ExecSpec = { task: "报告", artifacts: ["absent.md"], rubric: ["报告存在", "报告正确"] };
    const duplicate = '{"rubric":[{"item":"报告存在","pass":true},{"item":"报告存在","pass":true},{"item":"不相关项","pass":true}]}';
    const result = scoreExec(spec, duplicate, root);
    expect(result.rubricPassed).toBe(1);
    expect(result.score).toBe(0);
    expect(result.accepted).toBe(false);
    expect(scoreExec({ ...spec, artifacts: [] }, duplicate).score).toBe(50);
    expect(scoreExec(spec, duplicate).accepted).toBe(false);
    const conflict = '{"rubric":[{"item":"报告存在","pass":true},{"item":"报告存在","pass":false}]}';
    expect(scoreExec({ ...spec, artifacts: [] }, conflict).rubricPassed).toBe(0);
  });
  it("路径越界或绝对路径不读取；截取和二进制证据明确标识", () => {
    const root = sandbox();
    fs.writeFileSync(path.join(root, "long.md"), "A".repeat(17000));
    fs.writeFileSync(path.join(root, "image.bin"), Buffer.from([0, 1, 2]));
    const inspected = inspectArtifacts(root, ["../outside", root, "long.md", "image.bin"]);
    expect(inspected[0]?.error).toMatch(/越界/);
    expect(inspected[1]?.error).toMatch(/相对路径/);
    expect(inspected[2]?.truncated).toBe(true);
    expect(inspected[3]?.content).toBeUndefined();
    expect(validateArtifacts(root, ["../outside"])[0]?.pass).toBe(false);
  });
  it("固定 Node 检查使用真实产物，区分语法错误和失败的测试", () => {
    const root = sandbox();
    fs.writeFileSync(path.join(root, "ok.mjs"), "export const value = 1;");
    fs.writeFileSync(path.join(root, "bad.mjs"), "const = ;");
    fs.writeFileSync(path.join(root, "pass.test.mjs"), "import { test } from 'node:test'; import assert from 'node:assert/strict'; test('pass', () => assert.equal(1 + 1, 2));");
    fs.writeFileSync(path.join(root, "fail.test.mjs"), "import { test } from 'node:test'; import assert from 'node:assert/strict'; test('fail', () => assert.equal(1, 2));");
    const checks = validateArtifacts(root, [], [{ type: "node-syntax", file: "ok.mjs" }, { type: "node-syntax", file: "bad.mjs" }, { type: "node-test", file: "pass.test.mjs" }, { type: "node-test", file: "fail.test.mjs" }]);
    expect(checks.map((c) => c.pass)).toEqual([true, false, true, false]);
    expect(() => parseArtifactChecks([{ type: "shell", file: "x" }])).toThrow(/合法/);
  });
});
