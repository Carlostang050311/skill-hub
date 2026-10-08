import { describe, expect, it } from "vitest";
import type { SkillRecord } from "@skillhub/core";
import { descriptionTokens, detectCollisions } from "./collisions.js";

function rec(name: string, description: string): SkillRecord {
  return {
    id: `agents::${name}`,
    name,
    description,
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
      descriptionChars: description.length,
      descriptionTruncatedRisk: false,
      bodyChars: 200,
      bodyTooThin: false,
      missingResourceRefs: [],
      resourceFileCount: 0,
      warnings: [],
    },
    references: [],
    mentions: [],
    scannedAt: "now",
  };
}

describe("descriptionTokens", () => {
  it("拉丁词 + 中文二元组", () => {
    const tokens = descriptionTokens("Generate social cards and 小红书图文");
    expect(tokens.has("generate")).toBe(true);
    expect(tokens.has("cards")).toBe(true);
    expect(tokens.has("小红")).toBe(true);
    expect(tokens.has("红书")).toBe(true);
  });
});

describe("detectCollisions", () => {
  const skills = [
    rec("card-a", "Generate 小红书图文卡片、社交卡片图、公众号封面"),
    rec("card-b", "生成小红书图文卡片与公众号封面配图，杂志风社交卡片"),
    rec("unrelated", "Analyze cycling FIT tracks and export route stories"),
  ];

  it("高相似对被检出且共享词正确", () => {
    const pairs = detectCollisions(skills, 0.2);
    expect(pairs).toHaveLength(1);
    expect(pairs[0]?.a).toBe("card-a");
    expect(pairs[0]?.b).toBe("card-b");
    expect(pairs[0]?.sharedTerms).toContain("小红");
  });

  it("无关 skill 不误报；同名去重", () => {
    const pairs = detectCollisions([...skills, rec("card-a", "重复条目应被忽略")], 0.2);
    expect(pairs.every((p) => p.a !== p.b)).toBe(true);
    expect(pairs).toHaveLength(1);
  });

  it("阈值提高后不报", () => {
    expect(detectCollisions(skills, 0.99)).toEqual([]);
  });
});
