import type { SkillRecord } from "./types.js";

export interface Recommendation {
  name: string;
  score: number;
  reasons: string[];
}

const NAME_HIT = 30;
const NAME_PARTIAL = 12;
const DESC_TERM = 10;
const DESC_TERM_CAP = 40;
const QUALITY_BONUS = 5;
const QUALITY_PENALTY = 5;
const PENALTY_CAP = 20;
const TRUNCATION_PENALTY = 8;

function extractLatinTerms(task: string): string[] {
  return task
    .toLowerCase()
    .split(/[^a-z0-9-]+/)
    .filter((t) => t.length >= 2);
}

function extractCjkRuns(task: string): string[] {
  return task.match(/[\u4e00-\u9fff]{2,}/g) ?? [];
}

function cjkBigrams(run: string): string[] {
  const grams = new Set<string>();
  for (let i = 0; i + 2 <= run.length; i++) grams.add(run.slice(i, i + 2));
  return [...grams];
}

interface QueryTerms {
  latin: string[];
  cjkRuns: string[];
  cjkGrams: string[];
}

function extractTerms(task: string): QueryTerms {
  const cjkRuns = extractCjkRuns(task);
  return {
    latin: extractLatinTerms(task),
    cjkRuns,
    cjkGrams: cjkRuns.flatMap(cjkBigrams),
  };
}

function scoreSkill(record: SkillRecord, terms: QueryTerms, task: string): Recommendation | null {
  const reasons: string[] = [];
  let score = 0;

  const nameLower = record.name.toLowerCase();
  const nameCore = nameLower.replace(/-skill$/, "");
  const taskLower = task.toLowerCase();
  // 短名（≤3 字符，如 pr/qa）做子串匹配会撞上 prompt/quality 等英文词，必须词边界
  const shortName = nameLower.length <= 3;
  const nameHit = shortName
    ? new RegExp(`(^|[^a-z0-9-])${nameLower}([^a-z0-9-]|$)`).test(taskLower)
    : taskLower.includes(nameLower) || taskLower.includes(nameCore);
  if (nameHit) {
    score += NAME_HIT;
    reasons.push("任务描述中直接提到了这个 skill");
  } else if (terms.latin.some((t) => nameLower.includes(t) && t.length >= 4)) {
    score += NAME_PARTIAL;
    reasons.push("名称与任务关键词部分吻合");
  }

  const description = record.description.toLowerCase();
  let descHits = 0;
  for (const term of terms.latin) {
    if (term.length >= 3 && description.includes(term)) {
      descHits += 1;
      if (descHits <= 3) reasons.push(`描述命中关键词：${term}`);
    }
  }
  for (const run of terms.cjkRuns) {
    if (description.includes(run)) {
      descHits += 1;
      reasons.push(`描述命中：${run.slice(0, 12)}`);
      continue;
    }
    for (const gram of cjkBigrams(run)) {
      if (description.includes(gram)) {
        descHits += 1;
        if (descHits <= 4) reasons.push(`描述命中近义片段：${gram}`);
      }
    }
  }
  score += Math.min(descHits * DESC_TERM, DESC_TERM_CAP);

  if (record.quality.warnings.length === 0) {
    score += QUALITY_BONUS;
  } else {
    const penalty = Math.min(record.quality.warnings.length * QUALITY_PENALTY, PENALTY_CAP);
    score -= penalty;
    if (penalty > 0) reasons.push(`质量警告 −${penalty}`);
  }
  if (record.quality.descriptionTruncatedRisk) {
    score -= TRUNCATION_PENALTY;
    reasons.push("description 超长可能被客户端截断 −8");
  }
  if (record.quality.descriptionChars === 0) {
    score -= TRUNCATION_PENALTY;
    reasons.push("缺少 description，路由基本靠目录名 −8");
  }

  if (score <= 0 || reasons.length === 0) return null;
  return { name: record.name, score, reasons };
}

/** 按任务描述推荐最合适的 skill：名称直击 > 描述关键词命中 > 质量信号修正 */
export function recommendSkills(records: SkillRecord[], task: string, limit = 5): Recommendation[] {
  if (!task.trim()) return [];
  const terms = extractTerms(task);
  const byName = new Map<string, SkillRecord>();
  for (const record of records) {
    const existing = byName.get(record.name);
    if (!existing || record.quality.warnings.length < existing.quality.warnings.length) {
      byName.set(record.name, record);
    }
  }
  const scored: Recommendation[] = [];
  for (const record of byName.values()) {
    const rec = scoreSkill(record, terms, task);
    if (rec) scored.push(rec);
  }
  return scored.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name)).slice(0, limit);
}
