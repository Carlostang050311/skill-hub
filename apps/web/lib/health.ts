import type { SkillRecord } from "@skillhub/core";

export interface HealthRow {
  name: string;
  occurrences: number;
  sources: string[];
  warnings: number;
  score: number;
  grade: "优" | "良" | "中" | "差";
}

/** 静态健康分：每条警告扣 10 分，下限 0 */
export function healthScore(warnings: number): number {
  return Math.max(0, 100 - warnings * 10);
}

export function gradeOf(score: number): HealthRow["grade"] {
  if (score >= 90) return "优";
  if (score >= 70) return "良";
  if (score >= 50) return "中";
  return "差";
}

/** 按名字聚合出健康榜（同名多条记录取警告数最大值，代表最差表现） */
export function healthBoard(skills: SkillRecord[]): HealthRow[] {
  const map = new Map<string, { warnings: number; sources: Set<string>; occurrences: number }>();
  for (const skill of skills) {
    let entry = map.get(skill.name);
    if (!entry) {
      entry = { warnings: 0, sources: new Set(), occurrences: 0 };
      map.set(skill.name, entry);
    }
    entry.occurrences += 1;
    entry.sources.add(skill.source);
    entry.warnings = Math.max(entry.warnings, skill.quality.warnings.length);
  }
  return [...map.entries()]
    .map(([name, e]) => {
      const score = healthScore(e.warnings);
      return { name, occurrences: e.occurrences, sources: [...e.sources], warnings: e.warnings, score, grade: gradeOf(score) };
    })
    .sort((a, b) => a.score - b.score || a.name.localeCompare(b.name));
}

export interface CategoryCount {
  key: string;
  label: string;
  count: number;
}

const CATEGORY_MATCHERS: Array<{ key: string; label: string; match: (s: SkillRecord) => boolean }> = [
  { key: "truncated", label: "description 截断风险", match: (s) => s.quality.descriptionTruncatedRisk },
  { key: "missing-name", label: "缺 name / name 不规范", match: (s) => !s.quality.hasName || !s.quality.nameFormatOk },
  { key: "dir-mismatch", label: "name 与目录名不一致", match: (s) => s.quality.hasName && !s.quality.nameMatchesDir },
  { key: "thin", label: "正文过薄", match: (s) => s.quality.bodyTooThin },
  { key: "missing-res", label: "引用了不存在的资源", match: (s) => s.quality.missingResourceRefs.length > 0 },
];

/** 按质量信号类别统计有多少个 skill 触发（按去重名字计） */
export function warningCategories(skills: SkillRecord[]): CategoryCount[] {
  const seen = new Map<string, Set<string>>();
  for (const skill of skills) {
    for (const cat of CATEGORY_MATCHERS) {
      if (!cat.match(skill)) continue;
      let set = seen.get(cat.key);
      if (!set) {
        set = new Set();
        seen.set(cat.key, set);
      }
      set.add(skill.name);
    }
  }
  return CATEGORY_MATCHERS.map((cat) => ({
    key: cat.key,
    label: cat.label,
    count: seen.get(cat.key)?.size ?? 0,
  }));
}
