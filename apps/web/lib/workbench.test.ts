import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultRoots, scanAll } from "@skillhub/core";
import { buildJobs, type EvalTask, type RunReport } from "@skillhub/eval";
import type { SkillRecord } from "@skillhub/core";
import { hashContent } from "@skillhub/core";
import { currentTaskView, evalRunner, scenarioChoices, saveLocalScenario } from "./workbench.js";

afterEach(() => vi.unstubAllEnvs());

describe("评测用例文件恢复", () => {
  it("操作台与导出采用当前版本状态，同时保留历史任务原件", () => {
    const scenario = { skill: "demo", shouldTrigger: ["报告"], shouldNotTrigger: ["天气"] };
    const choices = [{ key: "local/demo.yaml", scenario }];
    const row = { skill: "demo", skillId: "claude::demo", skillHash: "original", scenarioHash: hashContent(JSON.stringify(scenario)), status: "complete", overall: 90, issues: [] };
    const task = { status: "completed", report: { results: [row], avgOverall: 90 } as RunReport } as EvalTask;
    const records = [{ id: "claude::demo", name: "demo", source: "claude", hash: "original" }] as SkillRecord[];
    expect(currentTaskView(task, records, choices).report?.results[0]?.status).toBe("complete");
    for (const view of [currentTaskView(task, [{ ...records[0]!, hash: "changed" }], choices), currentTaskView(task, records, [])]) {
      expect(view.status).toBe("failed");
      expect(view.report?.results[0]?.status).toBe("stale");
      expect(view.report?.results[0]?.overall).toBeNull();
      expect(view.report?.avgOverall).toBeNull();
    }
    expect(task.status).toBe("completed");
    expect(task.report?.results[0]?.overall).toBe(90);
    expect(task.report?.results[0]?.status).toBe("complete");
  });
  it("坏文件单独报告，正常任务仍评分；自己的用例损坏时标为过期", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "skillhub-workbench-"));
    vi.stubEnv("SKILLHUB_HOME", home);
    const skillDir = path.join(home, ".agents", "skills", "local-demo");
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(skillDir, "SKILL.md"), "---\nname: local-demo\ndescription: 数据报告\n---\n说明");
    const key = saveLocalScenario("local-demo", ["生成数据报告"], ["天气"]);
    const choice = scenarioChoices().find((c) => c.key === key)!;
    const jobs = buildJobs([choice.scenario], scanAll(defaultRoots(home)).skills).jobs;
    const runner = evalRunner();
    const good = runner.start({ jobs, backend: "zcode", model: "fixture" });
    const stale = runner.start({ jobs, backend: "zcode", model: "fixture" });
    const dir = path.join(home, ".skillhub", "scenarios");
    const broken = path.join(dir, "broken.yaml");
    fs.writeFileSync(broken, "skill: [");
    const errors: string[] = [];
    expect(scenarioChoices(errors).some((c) => c.key === key)).toBe(true);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("local/broken.yaml");
    const results = jobs.map((j) => ({ id: j.id, raw: JSON.stringify(j.type === "clarity" ? { consistency: 5, actionability: 5, boundedness: 5 } : { trigger: j.expectTrigger }) }));
    expect(runner.ingest(good.id, results).status).toBe("completed");
    fs.writeFileSync(path.join(dir, path.basename(key)), "skill: [");
    expect(runner.ingest(stale.id, results).report?.results[0]?.status).toBe("stale");
    expect(stale.status).toBe("failed");
    expect(stale.report?.results[0]?.overall).toBeNull();
    expect(fs.readFileSync(broken, "utf8")).toBe("skill: [");
  });
});
