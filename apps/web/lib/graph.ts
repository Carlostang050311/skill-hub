import type { SkillRecord } from "@skillhub/core";

export interface GraphNode {
  name: string;
  sources: string[];
  /** 硬链接（链接到其他 skill 的 SKILL.md / wiki 链接）出入度 */
  outDegree: number;
  inDegree: number;
  /** 正文提及的出入度 */
  mentionOut: number;
  mentionIn: number;
}

export interface GraphEdge {
  from: string;
  to: string;
  /** link = 显式链接，mention = 正文提及（软引用） */
  kind: "link" | "mention";
  /** 哪些具体 skill（按 id）支撑这条边 */
  fromIds: string[];
}

export interface SkillGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  linkEdgeCount: number;
  mentionEdgeCount: number;
  /** 完全没有引用关系的去重 skill 名数量 */
  isolatedCount: number;
}

/**
 * 从 skill 正文构建有向图。
 * - references（xxx/SKILL.md 链接、[[wiki]]）→ kind "link"
 * - mentions（正文词边界提及）→ kind "mention"；同一对 skill 已有 link 边时不再建 mention 边
 */
export function buildGraph(skills: SkillRecord[]): SkillGraph {
  const names = new Set(skills.map((s) => s.name));
  const degrees = new Map<string, { out: number; in: number; mOut: number; mIn: number; sources: Set<string> }>();
  const edgeMap = new Map<string, GraphEdge>();

  for (const skill of skills) {
    let entry = degrees.get(skill.name);
    if (!entry) {
      entry = { out: 0, in: 0, mOut: 0, mIn: 0, sources: new Set() };
      degrees.set(skill.name, entry);
    }
    entry.sources.add(skill.source);
  }

  const touch = (name: string, field: "out" | "in" | "mOut" | "mIn"): void => {
    const d = degrees.get(name);
    if (d) d[field] += 1;
  };

  for (const skill of skills) {
    for (const ref of skill.references) {
      if (ref === skill.name || !names.has(ref)) continue;
      const key = `link:${skill.name}->${ref}`;
      let edge = edgeMap.get(key);
      if (!edge) {
        edge = { from: skill.name, to: ref, kind: "link", fromIds: [] };
        edgeMap.set(key, edge);
      }
      if (!edge.fromIds.includes(skill.id)) edge.fromIds.push(skill.id);
      touch(skill.name, "out");
      touch(ref, "in");
    }
  }
  for (const skill of skills) {
    for (const ref of skill.mentions) {
      if (ref === skill.name || !names.has(ref)) continue;
      if (edgeMap.has(`link:${skill.name}->${ref}`)) continue;
      const key = `mention:${skill.name}->${ref}`;
      let edge = edgeMap.get(key);
      if (!edge) {
        edge = { from: skill.name, to: ref, kind: "mention", fromIds: [] };
        edgeMap.set(key, edge);
      }
      if (!edge.fromIds.includes(skill.id)) edge.fromIds.push(skill.id);
      touch(skill.name, "mOut");
      touch(ref, "mIn");
    }
  }

  const nodes = [...degrees.entries()]
    .filter(([, d]) => d.out > 0 || d.in > 0 || d.mOut > 0 || d.mIn > 0)
    .map(([name, d]) => ({
      name,
      sources: [...d.sources],
      outDegree: d.out,
      inDegree: d.in,
      mentionOut: d.mOut,
      mentionIn: d.mIn,
    }))
    .sort((a, b) => b.inDegree + b.mentionIn - (a.inDegree + a.mentionIn));

  const involved = new Set(nodes.map((n) => n.name));
  const isolatedCount = [...degrees.keys()].filter((name) => !involved.has(name)).length;
  const edges = [...edgeMap.values()];

  return {
    nodes,
    edges,
    linkEdgeCount: edges.filter((e) => e.kind === "link").length,
    mentionEdgeCount: edges.filter((e) => e.kind === "mention").length,
    isolatedCount,
  };
}

/** 谁链接了目标 skill（硬引用） */
export function reverseReferences(skills: SkillRecord[], targetName: string): string[] {
  if (!new Set(skills.map((s) => s.name)).has(targetName)) return [];
  const froms = new Set<string>();
  for (const skill of skills) {
    if (skill.name === targetName) continue;
    if (skill.references.includes(targetName)) froms.add(skill.name);
  }
  return [...froms].sort();
}

/** 谁在正文提及目标 skill（软引用） */
export function reverseMentions(skills: SkillRecord[], targetName: string): string[] {
  if (!new Set(skills.map((s) => s.name)).has(targetName)) return [];
  const froms = new Set<string>();
  for (const skill of skills) {
    if (skill.name === targetName) continue;
    if (skill.mentions.includes(targetName)) froms.add(skill.name);
  }
  return [...froms].sort();
}
