import { hashContent, type SkillRecord } from "@skillhub/core";
import { parseModelJson, pickPreferred } from "./jobs.js";
import type { EvalJob, JobResult, RunReport, Scenario, SkillEvalReport } from "./types.js";

const STATIC_PENALTY = 10;

function numbersOnly(values: Array<number | null>): number[] {
  const out: number[] = [];
  for (const v of values) {
    if (v != null) out.push(v);
  }
  return out;
}

export function staticScoreOf(record: SkillRecord): { score: number; warnings: number } {
  const warnings = record.quality.warnings.length;
  return { score: Math.max(0, 100 - warnings * STATIC_PENALTY), warnings };
}

function avg(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/** 完整且对应当前版本才给总分；缺失层不重新分配权重。 */
export function scoreRun(
  scenarios: Scenario[],
  records: SkillRecord[],
  jobs: EvalJob[],
  results: JobResult[],
  startedAt: string,
  backend: string,
  model?: string,
): RunReport {
  const byName = pickPreferred(records);
  const resultMap = new Map(results.map((r) => [r.id, r]));
  const jobBySkill = new Map<string, EvalJob[]>();
  for (const job of jobs) {
    const list = jobBySkill.get(job.skill);
    if (list) list.push(job);
    else jobBySkill.set(job.skill, [job]);
  }

  const reports: SkillEvalReport[] = [];
  const missingScenarios = new Set<string>();
  const planned = new Map(scenarios.map((sc) => [sc.skill, sc]));
  for (const [name, definitions] of jobBySkill) {
    if (planned.has(name)) continue;
    missingScenarios.add(name);
    planned.set(name, definitions.find((j) => j.scenario)?.scenario ?? { skill: name, shouldTrigger: definitions.filter((j) => j.type === "trigger" && j.expectTrigger).map(() => "用例已不可用"), shouldNotTrigger: definitions.filter((j) => j.type === "trigger" && !j.expectTrigger).map(() => "用例已不可用") });
  }
  for (const sc of planned.values()) {
    const skillJobs = jobBySkill.get(sc.skill) ?? [];
    const selectedId = skillJobs.find((j) => j.skillId)?.skillId;
    const rec = selectedId ? records.find((r) => r.id === selectedId && r.name === sc.skill) : byName.get(sc.skill);

    let correct = 0;
    let total = 0;
    let falsePositives = 0;
    let errors = 0;
    let completed = 0;
    const consistency: number[] = [];
    const actionability: number[] = [];
    const boundedness: number[] = [];
    const issues: string[] = [];

    for (const job of skillJobs) {
      const result = resultMap.get(job.id);
      if (!result || result.error) {
        errors += 1;
        issues.push(`${job.id}：${result?.error ?? "缺少结果"}`);
        continue;
      }
      const parsed = parseModelJson(result.raw);
      if (!parsed) {
        errors += 1;
        issues.push(`${job.id}：结果无法解析为 JSON`);
        continue;
      }
      if (job.type === "trigger" && typeof job.expectTrigger === "boolean") {
        if (typeof parsed.trigger !== "boolean") {
          errors += 1;
          issues.push(`${job.id}：trigger 必须是布尔值`);
          continue;
        }
        const said = parsed.trigger === true;
        if (said === job.expectTrigger) correct += 1;
        if (said && !job.expectTrigger) falsePositives += 1;
        total += 1;
        completed += 1;
      } else if (job.type === "clarity") {
        const valid = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 1 && value <= 5;
        const c = valid(parsed.consistency) ? parsed.consistency : null;
        const a = valid(parsed.actionability) ? parsed.actionability : null;
        const b = valid(parsed.boundedness) ? parsed.boundedness : null;
        if (c != null && a != null && b != null) {
          consistency.push(c);
          actionability.push(a);
          boundedness.push(b);
          completed += 1;
        } else {
          errors += 1;
          issues.push(`${job.id}：清晰度维度必须是 1–5 的数值`);
        }
        if (Array.isArray(parsed.issues)) {
          for (const item of parsed.issues) {
            if (typeof item === "string" && item.trim()) issues.push(item.trim());
          }
        }
      }
    }

    const { score: staticScore, warnings } = rec ? staticScoreOf(rec) : { score: 0, warnings: 0 };
    const triggerScore = total > 0 ? (correct / total) * 100 : null;
    const clarityScore =
      consistency.length > 0
        ? ((avg(consistency) ?? 0) + (avg(actionability) ?? 0) + (avg(boundedness) ?? 0)) / 15 * 100
        : null;

    const expectedJobs = 1 + sc.shouldTrigger.length + sc.shouldNotTrigger.length;
    const scenarioHash = hashContent(JSON.stringify(sc));
    const stale = !rec || missingScenarios.has(sc.skill) || skillJobs.some((j) => (j.skillId != null && j.skillId !== rec.id) || (j.skillHash != null && j.skillHash !== rec.hash) || (j.scenarioHash != null && j.scenarioHash !== scenarioHash));
    if (!rec || missingScenarios.has(sc.skill)) { errors += 1; issues.push(!rec ? "所选副本已不可用，保留原计划并要求重新评测" : "用例已不可用，保留原计划并要求重新评测"); }
    const expectedIds = new Set([`clarity:${sc.skill}`, ...Array.from({ length: expectedJobs - 1 }, (_, i) => `trigger:${sc.skill}:${i}`)]);
    const actualIds = new Set(skillJobs.map((j) => j.id));
    const validPlan = actualIds.size === expectedJobs && skillJobs.every((j) => expectedIds.has(j.id) && (j.type === "clarity" ? j.id === `clarity:${sc.skill}` : j.id.startsWith(`trigger:${sc.skill}:`) && j.expectTrigger === (Number(j.id.split(":").at(-1)) < sc.shouldTrigger.length)));
    errors += [...expectedIds].filter((id) => !actualIds.has(id)).length;
    if (!validPlan || skillJobs.length !== expectedJobs) issues.push("作业定义缺失、重复或与用例不一致，请重新生成作业");
    const complete = validPlan && completed === expectedJobs && skillJobs.length === expectedJobs && errors === 0 && triggerScore != null && clarityScore != null;
    const status = stale ? "stale" : complete ? "complete" : "incomplete";
    if (stale) issues.push("skill 或用例在作业生成后已变化，请重新评测");
    const overall = status === "complete" ? Math.round(0.4 * triggerScore! + 0.3 * clarityScore! + 0.3 * staticScore) : null;

    reports.push({
      skill: sc.skill,
      skillPath: rec?.skillPath ?? skillJobs[0]?.skillPath ?? "副本已不可用",
      source: rec?.source ?? selectedId?.split("::")[0] ?? "未知来源",
      skillId: selectedId,
      triggerScore: triggerScore != null ? Math.round(triggerScore) : null,
      triggerCorrect: correct,
      triggerTotal: total,
      falsePositives,
      clarityScore: clarityScore != null ? Math.round(clarityScore) : null,
      consistency: avg(consistency),
      actionability: avg(actionability),
      boundedness: avg(boundedness),
      issues,
      staticScore,
      warningCount: warnings,
      overall,
      errors,
      skillHash: skillJobs.find((j) => j.skillHash)?.skillHash,
      scenarioHash: skillJobs.find((j) => j.scenarioHash)?.scenarioHash,
      expectedJobs,
      completedJobs: completed,
      completionRate: Math.round(Math.min(completed, expectedJobs) / expectedJobs * 100),
      status,
    });
  }

  const allTrigger = numbersOnly(reports.map((r) => r.triggerScore));
  const allClarity = numbersOnly(reports.map((r) => r.clarityScore));
  const allOverall = numbersOnly(reports.map((r) => r.overall));
  return {
    startedAt,
    backend,
    model,
    results: reports,
    avgTrigger: avg(allTrigger),
    avgClarity: avg(allClarity),
    avgStatic: avg(reports.map((r) => r.staticScore)) ?? 0,
    avgOverall: avg(allOverall),
    expectedJobs: reports.reduce((n, r) => n + (r.expectedJobs ?? 0), 0),
    completedJobs: reports.reduce((n, r) => n + (r.completedJobs ?? 0), 0),
    completionRate: reports.length ? Math.round(reports.reduce((n, r) => n + (r.completedJobs ?? 0), 0) / reports.reduce((n, r) => n + (r.expectedJobs ?? 0), 0) * 100) : 0,
    errors: reports.reduce((n, r) => n + r.errors, 0),
  };
}
