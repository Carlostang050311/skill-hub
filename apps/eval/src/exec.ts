import fs from "node:fs";
import path from "node:path";
import type { SkillRecord } from "@skillhub/core";
import type { Scenario } from "./types.js";
import { parseModelJson } from "./jobs.js";

// ---------- scenario 的 execute 块 ----------

export interface ExecSpec {
  task: string;
  artifacts: string[];
  rubric: string[];
}

export function parseExecSpec(scenario: Scenario): ExecSpec | null {
  const exec = scenario.raw?.execute;
  if (!exec || typeof exec !== "object") return null;
  const map = exec as Record<string, unknown>;
  const strList = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim().length > 0) : [];
  const task = typeof map.task === "string" ? map.task.trim() : "";
  const rubric = strList(map.rubric);
  if (!task || rubric.length === 0) {
    throw new Error(`scenario ${scenario.skill}: execute 块需要 task 和 rubric`);
  }
  return { task, artifacts: strList(map.artifacts), rubric };
}

// ---------- 执行阶段 ----------

export function renderExecutorPrompt(input: { skillPath: string; sandboxDir: string; spec: ExecSpec }): string {
  return [
    "你是被评测的执行者。下面是一次真实作业：",
    "",
    `1. 先用工具阅读 skill 文件：${input.skillPath}——这是本任务的作业指导书，严格按它执行。`,
    `2. 工作目录（沙箱）：${input.sandboxDir}——所有产出文件只写在里面。`,
    `3. 任务：${input.spec.task}`,
    "",
    "完成后自查以下核查单（如实逐条判断，并给出一句话证据）：",
    ...input.spec.rubric.map((item, i) => `   ${i + 1}. ${item}`),
    "",
    "最后只输出 JSON（不要围栏和多余文字）：",
    '{"artifacts": ["生成的文件相对沙箱的路径"], "summary": "做了什么", "rubric": [{"item": "核查单项", "pass": true 或 false, "evidence": "一句话依据"}]}',
  ].join("\n");
}

export interface ExecReport {
  skill: string;
  sandboxDir: string;
  artifacts: string[];
  summary: string;
  rubric: Array<{ item: string; pass: boolean; evidence: string }>;
  /** 执行者 JSON 解析失败时 raw 保留原文 */
  raw: string;
  parseError?: string;
}

export function parseExecReport(skill: string, sandboxDir: string, raw: string): ExecReport {
  const parsed = parseModelJson(raw);
  if (!parsed) return { skill, sandboxDir, artifacts: [], summary: "", rubric: [], raw, parseError: "无法解析 JSON" };
  const rubric = Array.isArray(parsed.rubric)
    ? (parsed.rubric as Array<Record<string, unknown>>)
        .filter((r) => typeof r.item === "string")
        .map((r) => ({
          item: String(r.item),
          pass: r.pass === true,
          evidence: typeof r.evidence === "string" ? r.evidence : "",
        }))
    : [];
  return {
    skill,
    sandboxDir,
    artifacts: Array.isArray(parsed.artifacts) ? (parsed.artifacts as unknown[]).map(String) : [],
    summary: typeof parsed.summary === "string" ? parsed.summary : "",
    rubric,
    raw,
  };
}

// ---------- 评审阶段 ----------

export function renderJudgePrompt(input: { skill: string; spec: ExecSpec; report: ExecReport; fileListing: string }): string {
  return [
    "你是执行级评测的独立评审。执行者按某个 skill 的指导书在沙箱里完成了任务并自报了核查单，你需要独立复核。",
    "",
    `skill：${input.skill}`,
    `任务：${input.spec.task}`,
    `执行者自述：${input.report.summary || "（无）"}`,
    `自报产物：${input.report.artifacts.join(", ") || "（无）"}`,
    `沙箱目录实际文件清单：`,
    input.fileListing || "（空）",
    "",
    "核查单（逐条独立判断 pass/fail，并给一句话依据；执行者自评仅供参考，不要照抄）：",
    ...input.spec.rubric.map((item, i) => `   ${i + 1}. ${item}`),
    "",
    '只输出 JSON：{"rubric": [{"item": "核查单项", "pass": true 或 false, "evidence": "一句话依据"}], "overall_comment": "一句话总评"}',
  ].join("\n");
}

export function listSandboxFiles(sandboxDir: string): string {
  const out: string[] = [];
  const root = path.resolve(sandboxDir);
  const rootBoundary = root + path.sep;
  const visit = (current: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.resolve(current, entry.name);
      if (full !== root && !full.startsWith(rootBoundary)) continue;
      if (entry.isDirectory()) visit(full);
      else if (entry.isFile()) out.push(path.relative(root, full).split(path.sep).join("/"));
    }
  };
  visit(root);
  return out.sort().join("\n");
}

export interface ExecJudgeResult {
  rubricTotal: number;
  rubricPassed: number;
  /** 评审确认的通过率 0-100 */
  score: number;
  issues: string[];
  comment: string;
  parseError?: string;
}

/** 宽松匹配键：小写、去掉所有非字母数字汉字字符，容忍评审复述措辞差异 */
export function normalizeItem(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]/g, "");
}

export interface JudgePairResult {
  /** spec rubric 项数 */
  total: number;
  /** 两评审都覆盖到且判定一致的项数 */
  agree: number;
  /** 一致率（以两评审都覆盖的项为分母；都未覆盖不计） */
  agreement: number;
  /** 评审甲明确通过的 spec 项数 */
  passedA: number;
  /** 评审甲未覆盖的 spec 项文本 */
  missingA: string[];
  /** 评审乙未覆盖的 spec 项文本 */
  missingB: string[];
  /** 评审甲判定未通过的项及证据 */
  issues: string[];
}

function indexByNormalized(rubric: Array<{ item: string; pass: boolean; evidence?: string }>): Map<string, { pass: boolean; evidence: string }> {
  const map = new Map<string, { pass: boolean; evidence: string }>();
  for (const r of rubric) {
    const key = normalizeItem(r.item);
    if (key && !map.has(key)) map.set(key, { pass: r.pass, evidence: r.evidence ?? "" });
  }
  return map;
}

/**
 * 双评审一致率：spec 逐项在甲乙各自返回里做宽松匹配（归一化文本），
 * 都覆盖且判定相同计一致；任一未覆盖记入 missing（不冒充"未通过"，也不冒充"一致"）。
 */
export function judgeAgreement(spec: ExecSpec, judgeARaw: string, judgeBRaw: string): JudgePairResult {
  const parse = (raw: string) => {
    const parsed = parseModelJson(raw);
    if (!parsed || !Array.isArray(parsed.rubric)) return null;
    return (parsed.rubric as Array<Record<string, unknown>>)
      .filter((r) => typeof r.item === "string")
      .map((r) => ({ item: String(r.item), pass: r.pass === true, evidence: typeof r.evidence === "string" ? r.evidence : "" }));
  };
  const rubricA = parse(judgeARaw);
  const rubricB = parse(judgeBRaw);
  const total = spec.rubric.length;
  if (!rubricA || !rubricB) {
    return { total, agree: 0, agreement: 0, passedA: 0, missingA: [...spec.rubric], missingB: [...spec.rubric], issues: ["评审 JSON 缺失或无法解析"] };
  }
  const mapA = indexByNormalized(rubricA);
  const mapB = indexByNormalized(rubricB);
  let agree = 0;
  let bothCovered = 0;
  let passedA = 0;
  const missingA: string[] = [];
  const missingB: string[] = [];
  const issues: string[] = [];
  for (const item of spec.rubric) {
    const key = normalizeItem(item);
    const inA = mapA.get(key) ?? ((): { pass: boolean; evidence: string } | undefined => {
      // 归一化键未命中时，尝试 judge 项包含 spec 项的反向宽松匹配
      for (const [judgeKey, value] of mapA) {
        if (judgeKey.includes(key) || key.includes(judgeKey)) return value;
      }
      return undefined;
    })();
    const inB = mapB.get(key) ?? ((): { pass: boolean; evidence: string } | undefined => {
      for (const [judgeKey, value] of mapB) {
        if (judgeKey.includes(key) || key.includes(judgeKey)) return value;
      }
      return undefined;
    })();
    if (!inA) missingA.push(item);
    if (!inB) missingB.push(item);
    if (inA && inB) {
      bothCovered += 1;
      if (inA.pass === inB.pass) agree += 1;
    }
    if (inA) {
      if (inA.pass) passedA += 1;
      else issues.push(item.slice(0, 40) + (inA.evidence ? "：" + inA.evidence.slice(0, 80) : ""));
    }
  }
  return {
    total,
    agree,
    agreement: bothCovered > 0 ? Math.round((agree / bothCovered) * 100) : 0,
    passedA,
    missingA,
    missingB,
    issues,
  };
}
export function scoreExec(spec: ExecSpec, judgeRaw: string): ExecJudgeResult {
  const parsed = parseModelJson(judgeRaw);
  if (!parsed || !Array.isArray(parsed.rubric)) {
    return { rubricTotal: spec.rubric.length, rubricPassed: 0, score: 0, issues: [], comment: "", parseError: "评审 JSON 无法解析" };
  }
  const judged = parsed.rubric as Array<Record<string, unknown>>;
  const passed = judged.filter((r) => r.pass === true).length;
  const issues = judged
    .filter((r) => r.pass !== true && typeof r.evidence === "string" && r.evidence.trim())
    .map((r) => `${String(r.item).slice(0, 40)}：${String(r.evidence).slice(0, 80)}`);
  return {
    rubricTotal: spec.rubric.length,
    rubricPassed: passed,
    score: Math.round((passed / spec.rubric.length) * 100),
    issues,
    comment: typeof parsed.overall_comment === "string" ? parsed.overall_comment : "",
  };
}

export function ensureSandbox(root: string, skill: string): string {
  const dir = path.resolve(root, skill);
  const boundary = path.resolve(root) + path.sep;
  if (dir !== path.resolve(root) && !dir.startsWith(boundary)) throw new Error(`沙箱路径越界：${dir}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export interface ExecScenario {
  scenario: Scenario;
  spec: ExecSpec;
  record: SkillRecord;
}
