import type { SkillRecord } from "./types.js";

export interface CollisionPair {
  a: string;
  b: string;
  /** 词级 Jaccard 相似度（拉丁词 + 中文二元组） */
  jaccard: number;
  sharedTerms: string[];
}

/** 描述分词：拉丁词（≥3 字符）+ 中文二元组 */
export function descriptionTokens(s: string): Set<string> {
  const tokens = new Set<string>();
  const lower = s.toLowerCase();
  for (const w of lower.matchAll(/[a-z][a-z0-9-]{2,}/g)) {
    if (w[0]) tokens.add(w[0]);
  }
  for (const run of lower.matchAll(/[\u4e00-\u9fff]{2,}/g)) {
    const r = run[0];
    if (!r) continue;
    for (let i = 0; i + 2 <= r.length; i++) {
      const gram = r.slice(i, i + 2);
      if (gram) tokens.add(gram);
    }
  }
  return tokens;
}

/**
 * 触发域重叠检测：两两 skill 的描述相似度 ≥ 阈值即报告。
 * 用于发现"两个 skill 抢同一批任务"的隐性混乱（如库里两个小红书卡片 skill）。
 */
export function detectCollisions(skills: SkillRecord[], minJaccard = 0.35): CollisionPair[] {
  const byName = new Map<string, SkillRecord>();
  for (const s of skills) {
    if (!byName.has(s.name)) byName.set(s.name, s);
  }
  const entries = [...byName.values()];
  const tokenCache = entries.map((e) => ({ name: e.name, tokens: descriptionTokens(e.description) }));
  const out: CollisionPair[] = [];
  for (let i = 0; i < tokenCache.length; i++) {
    const a = tokenCache[i]!;
    for (let j = i + 1; j < tokenCache.length; j++) {
      const b = tokenCache[j]!;
      if (a.tokens.size === 0 || b.tokens.size === 0) continue;
      let inter = 0;
      for (const t of a.tokens) {
        if (b.tokens.has(t)) inter += 1;
      }
      const union = a.tokens.size + b.tokens.size - inter;
      const jaccard = union > 0 ? inter / union : 0;
      if (jaccard >= minJaccard) {
        const shared = [...a.tokens].filter((t) => b.tokens.has(t)).slice(0, 6);
        out.push({ a: a.name, b: b.name, jaccard: Math.round(jaccard * 100) / 100, sharedTerms: shared });
      }
    }
  }
  return out.sort((x, y) => y.jaccard - x.jaccard);
}
