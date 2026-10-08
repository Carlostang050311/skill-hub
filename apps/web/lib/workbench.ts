import fs from "node:fs";
import path from "node:path";
import { defaultRoots, hashContent, scanAll } from "@skillhub/core";
import { EvalTaskRunner, insertRun, parseScenarioYaml, openDb, scoreRun, type Scenario } from "@skillhub/eval";
import { projectRoot, skillhubHome, stateRoot } from "./paths";

export interface ScenarioChoice { key: string; scenario: Scenario }
export function scenarioChoices(): ScenarioChoice[] {
  return ["scenarios", "scenarios-auto", "local"].flatMap((dir) => {
    const root = dir === "local" ? path.join(stateRoot(), "scenarios") : path.join(projectRoot(), dir);
    if (!fs.existsSync(root)) return [];
    return fs.readdirSync(root).filter((f) => /\.ya?ml$/i.test(f)).sort().map((file) => ({ key: `${dir}/${file}`, scenario: parseScenarioYaml(fs.readFileSync(path.join(root, file), "utf8"), file) }));
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
      return scoreRun(scenarios, scanAll(defaultRoots(skillhubHome())).skills, task.jobs, task.results, task.createdAt, task.backend, task.model);
    }, (report) => {
      const db = openDb(path.join(stateRoot(), "eval.db"));
      try { insertRun(db, report); } finally { db.close(); }
    });
    scope.skillhubEvalRunners.set(root, runner);
  }
  return runner;
}
