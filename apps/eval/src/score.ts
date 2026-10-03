import type { SkillRecord } from "@skillhub/core";
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

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function avg(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/** 汇总作业结果为每 skill 报告；overall = 触发 40% + 清晰度 30% + 静态 30%（缺失层权重再归一） */
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
  for (const sc of scenarios) {
    const rec = byName.get(sc.skill);
    const skillJobs = jobBySkill.get(sc.skill) ?? [];
    if (!rec) continue;

    let correct = 0;
    let total = 0;
    let falsePositives = 0;
    let errors = 0;
    const consistency: number[] = [];
    const actionability: number[] = [];
    const boundedness: number[] = [];
    const issues: string[] = [];

    for (const job of skillJobs) {
      const result = resultMap.get(job.id);
      if (!result) {
        errors += 1;
        continue;
      }
      const parsed = parseModelJson(result.raw);
      if (!parsed) {
        errors += 1;
        continue;
      }
      if (job.type === "trigger" && typeof job.expectTrigger === "boolean") {
        const said = parsed.trigger === true;
        if (said === job.expectTrigger) correct += 1;
        if (said && !job.expectTrigger) falsePositives += 1;
        total += 1;
      } else if (job.type === "clarity") {
        const c = typeof parsed.consistency === "number" ? clamp(parsed.consistency, 1, 5) : null;
        const a = typeof parsed.actionability === "number" ? clamp(parsed.actionability, 1, 5) : null;
        const b = typeof parsed.boundedness === "number" ? clamp(parsed.boundedness, 1, 5) : null;
        if (c != null && a != null && b != null) {
          consistency.push(c);
          actionability.push(a);
          boundedness.push(b);
        } else {
          errors += 1;
        }
        if (Array.isArray(parsed.issues)) {
          for (const item of parsed.issues) {
            if (typeof item === "string" && item.trim()) issues.push(item.trim());
          }
        }
      }
    }

    const { score: staticScore, warnings } = staticScoreOf(rec);
    const triggerScore = total > 0 ? (correct / total) * 100 : null;
    const clarityScore =
      consistency.length > 0
        ? ((avg(consistency) ?? 0) + (avg(actionability) ?? 0) + (avg(boundedness) ?? 0)) / 15 * 100
        : null;

    const layers: Array<{ weight: number; value: number }> = [];
    if (triggerScore != null) layers.push({ weight: 0.4, value: triggerScore });
    if (clarityScore != null) layers.push({ weight: 0.3, value: clarityScore });
    layers.push({ weight: 0.3, value: staticScore });
    const weightSum = layers.reduce((n, l) => n + l.weight, 0);
    const overall = Math.round(layers.reduce((n, l) => n + l.weight * l.value, 0) / weightSum);

    reports.push({
      skill: sc.skill,
      skillPath: rec.skillPath,
      source: rec.source,
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
  };
}
