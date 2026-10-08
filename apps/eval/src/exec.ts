import fs from "node:fs";
import path from "node:path";
import type { SkillRecord } from "@skillhub/core";
import type { Scenario } from "./types.js";
import { parseModelJson } from "./jobs.js";
import { inspectArtifacts, parseArtifactChecks, validateArtifacts, type ArtifactCheck, type ArtifactCheckResult } from "./artifacts.js";

// ---------- scenario 的 execute 块 ----------

export interface ExecSpec {
  task: string;
  artifacts: string[];
  rubric: string[];
  checks?: ArtifactCheck[];
}

export interface ExecBinding { skillId?: string; skillHash?: string; scenarioHash?: string }
export function execBindingStatus(binding: ExecBinding, records: SkillRecord[], scenarioHash?: string): "bound" | "stale" | "unverified" {
  if (!binding.skillId || !binding.skillHash || !binding.scenarioHash) return "unverified";
  const current = records.find((r) => r.id === binding.skillId);
  return !current || current.hash !== binding.skillHash || (scenarioHash !== undefined && binding.scenarioHash !== scenarioHash) ? "stale" : "bound";
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
  if (new Set(rubric.map(normalizeItem)).size !== rubric.length) throw new Error("rubric 不得包含重复项");
  return { task, artifacts: strList(map.artifacts), rubric, checks: parseArtifactChecks(map.checks) };
}

// ---------- 执行阶段 ----------

export function renderExecutorPrompt(input: { skillPath: string; sandboxDir: string; spec: ExecSpec }): string {
  return [
    "你是被评测的执行者。下面是一次真实作业：",
    "",
    `1. 先用工具阅读 skill 文件：${input.skillPath}——这是本任务的作业指导书，严格按它执行。`,
    `2. 工作目录（沙箱）：${input.sandboxDir}——所有产出文件只写在里面。`,
    `3. 任务：${input.spec.task}`,
    `4. 预期产物：${input.spec.artifacts.join(", ") || "按任务要求"}。工作目录仅是输出约束，不提供操作系统隔离。`,
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
        .filter((r) => r != null && typeof r === "object" && typeof r.item === "string")
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
    "真实产物证据（内容截取明确标记；二进制只展示大小和指纹；不要把截取内容当成全文）：",
    JSON.stringify(inspectArtifacts(input.report.sandboxDir, [...input.spec.artifacts, ...input.report.artifacts]), null, 2),
    "程序验收结果（任一失败均不得判整体通过）：",
    JSON.stringify(validateArtifacts(input.report.sandboxDir, input.spec.artifacts, input.spec.checks), null, 2),
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
  checks?: ArtifactCheckResult[];
  accepted?: boolean;
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
    if (key) {
      const existing = map.get(key);
      map.set(key, { pass: r.pass && (existing?.pass ?? true), evidence: r.evidence ?? existing?.evidence ?? "" });
    }
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
      .filter((r) => r != null && typeof r === "object" && typeof r.item === "string")
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
export function scoreExec(spec: ExecSpec, judgeRaw: string, sandboxDir?: string): ExecJudgeResult {
  const parsed = parseModelJson(judgeRaw);
  if (!parsed || !Array.isArray(parsed.rubric)) {
    return { rubricTotal: spec.rubric.length, rubricPassed: 0, score: 0, issues: [], comment: "", parseError: "评审 JSON 无法解析" };
  }
  const judged = (parsed.rubric as Array<unknown>).filter((r): r is Record<string, unknown> => r != null && typeof r === "object");
  const byItem = indexByNormalized(judged.filter((r) => typeof r.item === "string").map((r) => ({ item: String(r.item), pass: r.pass === true, evidence: typeof r.evidence === "string" ? r.evidence : "" })));
  const passed = spec.rubric.filter((item) => byItem.get(normalizeItem(item))?.pass).length;
  const issues = spec.rubric.filter((item) => !byItem.get(normalizeItem(item))?.pass).map((item) => `${item}：${byItem.get(normalizeItem(item))?.evidence || "评审未覆盖或未通过"}`);
  const checks = sandboxDir ? validateArtifacts(sandboxDir, spec.artifacts, spec.checks) : undefined;
  const failedChecks = checks?.filter((c) => !c.pass) ?? [];
  issues.push(...failedChecks.map((c) => `${c.file}（${c.type}）：${c.evidence}`));
  const unverified = !sandboxDir && (spec.artifacts.length > 0 || (spec.checks?.length ?? 0) > 0);
  if (unverified) issues.push("缺少真实工作目录，产物未验收");
  return {
    rubricTotal: spec.rubric.length,
    rubricPassed: passed,
    score: failedChecks.length || unverified ? 0 : spec.rubric.length ? Math.round((passed / spec.rubric.length) * 100) : 0,
    issues,
    comment: typeof parsed.overall_comment === "string" ? parsed.overall_comment : "",
    checks,
    accepted: !unverified && failedChecks.length === 0 && passed === spec.rubric.length && spec.rubric.length > 0,
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
