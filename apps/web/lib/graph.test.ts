import { describe, expect, it } from "vitest";
import type { SkillRecord } from "@skillhub/core";
import { buildGraph, reverseMentions, reverseReferences } from "./graph.js";

function rec(name: string, references: string[] = [], over: Partial<SkillRecord> = {}): SkillRecord {
  return {
    id: `agents::${name}`,
    name,
    description: "d",
    extraFrontmatter: {},
    source: "agents",
    sourceKind: "agents-global",
    skillPath: `/${name}/SKILL.md`,
    skillDir: `/${name}`,
    dirName: name,
    relativeId: name,
    files: [],
    bodyChars: 200,
    hash: `h-${name}`,
    quality: {
      hasName: true,
      nameMatchesDir: true,
      nameFormatOk: true,
      descriptionChars: 10,
      descriptionTruncatedRisk: false,
      bodyChars: 200,
      bodyTooThin: false,
      missingResourceRefs: [],
      resourceFileCount: 0,
      warnings: [],
    },
    references,
    mentions: [],
    scannedAt: "now",
    ...over,
  };
}

describe("buildGraph", () => {
  it("构建有向边并统计出入度", () => {
    const g = buildGraph([rec("a", ["b"]), rec("c", ["b"]), rec("b", [])]);
    expect(g.edges).toEqual([
      { from: "a", to: "b", kind: "link", fromIds: ["agents::a"] },
      { from: "c", to: "b", kind: "link", fromIds: ["agents::c"] },
    ]);
    const a = g.nodes.find((n) => n.name === "a");
    const b = g.nodes.find((n) => n.name === "b");
    expect(a?.outDegree).toBe(1);
    expect(b?.inDegree).toBe(2);
  });

  it("提及生成虚线边，已有链接边时不重复建边", () => {
    const g = buildGraph([
      rec("a", ["b"]),
      rec("c", [], { references: [], mentions: ["b"] }),
      rec("b", [], { mentions: ["c"] }),
    ]);
    const kinds = g.edges.map((e) => `${e.from}->${e.to}:${e.kind}`);
    expect(kinds).toEqual(["a->b:link", "c->b:mention", "b->c:mention"]);
    const c = g.nodes.find((n) => n.name === "c");
    expect(c?.mentionOut).toBe(1);
    expect(c?.mentionIn).toBe(1);
    expect(g.linkEdgeCount).toBe(1);
    expect(g.mentionEdgeCount).toBe(2);
  });

  it("忽略自引用与未知目标", () => {
    const g = buildGraph([rec("a", ["a", "ghost", "b"]), rec("b", [])]);
    expect(g.edges.map((e) => `${e.from}->${e.to}`)).toEqual(["a->b"]);
  });

  it("同名 skill 的重复引用合并为一条边并记录全部来源 id", () => {
    const g = buildGraph([rec("a", ["b", "b"]), rec("a", ["b"], { id: "claude::a", source: "claude" }), rec("b", [])]);
    const edge = g.edges.find((e) => e.from === "a" && e.to === "b");
    expect(edge?.fromIds).toEqual(["agents::a", "claude::a"]);
  });

  it("isolatedCount 统计无引用关系的去重名字", () => {
    const g = buildGraph([rec("a", ["b"]), rec("b", []), rec("lonely", [])]);
    expect(g.isolatedCount).toBe(1);
  });
});

describe("reverseReferences / reverseMentions", () => {
  it("返回引用目标的去重名字并排序", () => {
    const skills = [rec("b"), rec("c", ["b"], { id: "claude::c", source: "claude" }), rec("a", ["b"])];
    expect(reverseReferences(skills, "b")).toEqual(["a", "c"]);
  });

  it("提及单独统计", () => {
    const skills = [rec("b"), rec("a", [], { mentions: ["b"] }), rec("c", ["b"])];
    expect(reverseReferences(skills, "b")).toEqual(["c"]);
    expect(reverseMentions(skills, "b")).toEqual(["a"]);
  });

  it("目标不在库内时返回空", () => {
    expect(reverseReferences([rec("a")], "ghost")).toEqual([]);
    expect(reverseMentions([rec("a")], "ghost")).toEqual([]);
  });
});
