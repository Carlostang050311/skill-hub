import { describe, expect, it } from "vitest";
import type { SkillRecord } from "@skillhub/core";
import { gradeOf, healthBoard, healthScore, warningCategories } from "./health.js";

function rec(name: string, warnings: string[] = [], over: Partial<SkillRecord> = {}): SkillRecord {
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
      warnings,
    },
    references: [],
    mentions: [],
    scannedAt: "now",
    ...over,
  };
}

describe("healthScore / gradeOf", () => {
  it("每条警告扣 10 分且下限为 0", () => {
    expect(healthScore(0)).toBe(100);
    expect(healthScore(3)).toBe(70);
    expect(healthScore(20)).toBe(0);
  });

  it("评级分档", () => {
    expect(gradeOf(95)).toBe("优");
    expect(gradeOf(80)).toBe("良");
    expect(gradeOf(60)).toBe("中");
    expect(gradeOf(30)).toBe("差");
  });
});

describe("healthBoard", () => {
  it("同名多条记录取最差警告数", () => {
    const board = healthBoard([
      rec("a", ["w1"]),
      rec("a", [], { id: "claude::a", source: "claude" }),
      rec("clean"),
    ]);
    const a = board.find((r) => r.name === "a");
    expect(a?.warnings).toBe(1);
    expect(a?.score).toBe(90);
    expect(a?.occurrences).toBe(2);
    expect(a?.sources).toEqual(["agents", "claude"]);
    const clean = board.find((r) => r.name === "clean");
    expect(clean?.grade).toBe("优");
    expect(board[0]?.name).toBe("a");
  });
});

describe("warningCategories", () => {
  it("按去重名字统计各类信号", () => {
    const base = { quality: rec("x").quality };
    const truncated = { ...rec("t"), quality: { ...base.quality, descriptionTruncatedRisk: true, warnings: ["截断"] } };
    const thin = { ...rec("s"), quality: { ...base.quality, bodyTooThin: true, warnings: ["过薄"] } };
    const count = warningCategories([truncated, { ...truncated, id: "claude::t", source: "claude" }, thin, rec("ok")]);
    expect(count.find((c) => c.key === "truncated")?.count).toBe(1);
    expect(count.find((c) => c.key === "thin")?.count).toBe(1);
    expect(count.find((c) => c.key === "missing-res")?.count).toBe(0);
  });
});
