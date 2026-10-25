import fs from "node:fs";
import path from "node:path";
import { hashContent, type SkillRecord } from "@skillhub/core";
import { EvalTaskRunner, insertRun, parseScenarioYaml, openDb, scoreRun, type EvalTask, type Scenario } from "@skillhub/eval";
import { projectRoot, stateRoot } from "./paths";
import { getInventory } from "./data";
import { reportStatus } from "./report-status";

export interface ScenarioChoice { key: string; scenario: Scenario }
/** 展示和导出复核当前指纹，历史任务与原始分数保持不变。 */
export function currentTaskView(task: EvalTask, records: SkillRecord[], choices: ScenarioChoice[]): EvalTask {
  if (!task.report) return task;
  const results = task.report.results.map((row) => {
    const record = records.find((r) => row.skillId ? r.id === row.skillId : r.name === row.skill && r.source === row.source);
    const stale = reportStatus(row, record) === "stale" || Boolean(row.scenarioHash && !choices.some((c) => c.scenario.skill === row.skill && hashContent(JSON.stringify(c.scenario)) === row.scenarioHash));
    if (!stale) return row;
    const issue = "skill 或用例版本已变化，需要重新评测";
    return { ...row, status: "stale" as const, overall: null, issues: row.issues.includes(issue) ? row.issues : [...row.issues, issue] };
  });
  if (!results.some((row) => row.status === "stale")) return task;
  return { ...task, status: task.status === "completed" ? "failed" : task.status, error: "skill 或用例版本已变化，历史任务原件保留，请重新评测", report: { ...task.report, results, avgOverall: null } };
}
export function scenarioChoices(recoveryErrors: string[] = []): ScenarioChoice[] {
  return ["scenarios", "scenarios-auto", "local"].flatMap((dir) => {
    const root = dir === "local" ? path.join(stateRoot(), "scenarios") : path.join(projectRoot(), dir);
    if (!fs.existsSync(root)) return [];
    return fs.readdirSync(root).filter((f) => /\.ya?ml$/i.test(f)).sort().flatMap((file) => {
      const key = `${dir}/${file}`;
      try { return [{ key, scenario: parseScenarioYaml(fs.readFileSync(path.join(root, file), "utf8"), key) }]; }
      catch (error) { recoveryErrors.push(`用例文件无法读取，已保留原文件：${key} · ${error instanceof Error ? error.message : "解析失败"}`); return []; }
    });
  });
}

export function saveLocalScenario(skill: string, positives: string[], negatives: string[]): string {
  const raw = JSON.stringify({ skill, should_trigger: positives, should_not_trigger: negatives }, null, 2) + "\n";
  parseScenarioYaml(raw, "本地用例");
  const file = `${hashContent(skill)}.yaml`;
  const dir = path.join(stateRoot(), "scenarios");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, file), raw, "utf8");
  return `local/${file}`;
}
export function evalRunner(): EvalTaskRunner {
  const scope = globalThis as typeof globalThis & { skillhubEvalRunners?: Map<string, EvalTaskRunner> };
  scope.skillhubEvalRunners ??= new Map();
  const root = path.join(stateRoot(), "tasks");
  let runner = scope.skillhubEvalRunners.get(root);
  if (!runner) {
    runner = new EvalTaskRunner(root, (task) => {
      const choices = scenarioChoices();
      const names = [...new Set(task.jobs.map((j) => j.skill))];
      const scenarios = names.flatMap((name) => {
        const candidates = choices.filter((c) => c.scenario.skill === name);
        const expectedHash = task.jobs.find((j) => j.skill === name)?.scenarioHash;
        const selected = candidates.find((c) => hashContent(JSON.stringify(c.scenario)) === expectedHash) ?? candidates[0];
        return selected ? [selected.scenario] : [];
      });
      return scoreRun(scenarios, getInventory().result.skills, task.jobs, task.results, task.createdAt, task.backend, task.model);
    }, (report) => {
      const db = openDb(path.join(stateRoot(), "eval.db"));
      try { insertRun(db, report); } finally { db.close(); }
    });
    scope.skillhubEvalRunners.set(root, runner);
  }
  return runner;
}
