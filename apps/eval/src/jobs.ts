import fs from "node:fs";
import type { SkillRecord } from "@skillhub/core";
import { parseSkillSource } from "@skillhub/core";
import { renderClarityPrompt, renderTriggerPrompt } from "./prompts.js";
import type { EvalJob, JobResult, Scenario } from "./types.js";

/** 同名多目录时优先评 agents 来源，其次按来源名排序取第一个 */
export function pickPreferred(records: SkillRecord[]): Map<string, SkillRecord> {
  const map = new Map<string, SkillRecord>();
  const order = (source: string): number => (source === "agents" ? 0 : 1);
  for (const rec of records) {
    const existing = map.get(rec.name);
    if (!existing || order(rec.source) < order(existing.source)) map.set(rec.name, rec);
  }
  return map;
}

export interface PlanOutput {
  jobs: EvalJob[];
  /** scenario 引用了库中不存在的 skill */
  skipped: string[];
}

/** 从 scenario 构建作业：每个 skill 一条 clarity + 每条用例一条 trigger */
export function buildJobs(scenarios: Scenario[], records: SkillRecord[]): PlanOutput {
  const byName = pickPreferred(records);
  const jobs: EvalJob[] = [];
  const skipped: string[] = [];
  for (const sc of scenarios) {
    const rec = byName.get(sc.skill);
    if (!rec) {
      skipped.push(sc.skill);
      continue;
    }
    const { body } = parseSkillSource(fs.readFileSync(rec.skillPath, "utf8"));
    jobs.push({
      id: `clarity:${sc.skill}`,
      type: "clarity",
      skill: sc.skill,
      messages: [{ role: "user", content: renderClarityPrompt({ name: rec.name, body }) }],
    });
    let caseIndex = 0;
    for (const utterance of sc.shouldTrigger) {
      jobs.push({
        id: `trigger:${sc.skill}:${caseIndex}`,
        type: "trigger",
        skill: sc.skill,
        expectTrigger: true,
        messages: [{ role: "user", content: renderTriggerPrompt({ name: rec.name, description: rec.description, utterance }) }],
      });
      caseIndex += 1;
    }
    for (const utterance of sc.shouldNotTrigger) {
      jobs.push({
        id: `trigger:${sc.skill}:${caseIndex}`,
        type: "trigger",
        skill: sc.skill,
        expectTrigger: false,
        messages: [{ role: "user", content: renderTriggerPrompt({ name: rec.name, description: rec.description, utterance }) }],
      });
      caseIndex += 1;
    }
  }
  return { jobs, skipped };
}

/** 从模型输出中稳健地提取 JSON 对象：容忍代码围栏与前后杂文 */
export function parseModelJson(raw: string): Record<string, unknown> | null {
  let text = raw.trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence?.[1]) text = fence[1].trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    const parsed: unknown = JSON.parse(text.slice(start, end + 1));
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function parseResultsFile(text: string): JobResult[] {
  const out: JobResult[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const obj = JSON.parse(trimmed) as { id?: unknown; raw?: unknown };
      if (typeof obj.id === "string" && typeof obj.raw === "string") {
        out.push({ id: obj.id, raw: obj.raw });
      }
    } catch {
      // 跳过坏行，不让单行失败毁掉整个文件
    }
  }
  return out;
}
