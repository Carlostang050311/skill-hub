import { describe, expect, it } from "vitest";
import type { SkillRecord } from "@skillhub/core";
import { recommendSkills } from "./recommend.js";

function rec(name: string, description: string, warnings: string[] = []): SkillRecord {
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
      warnings,
    },
    references: [],
    mentions: [],
    scannedAt: "now",
  };
}

describe("recommendSkills", () => {
  const skills = [
    rec("guizang-social-card-skill", "Generate social card image sets, 小红书图文, Live Photo 实况照片, 微信公众号封面 covers."),
    rec("youtube-clipper", "YouTube 视频智能剪辑工具。下载视频和字幕，剪辑、翻译字幕为中英双语、烧录字幕。"),
    rec("humanizer-zh", "编辑中文文章中的空话、重复及模板化表达，让文字更自然。"),
    rec("tdd", "Test-driven development. Use when the user wants to build features test-first."),
  ];

  it("中文关键词按描述命中排序", () => {
    const result = recommendSkills(skills, "帮我剪一段 YouTube 视频并加上双语字幕");
    expect(result[0]?.name).toBe("youtube-clipper");
    expect(result[0]?.reasons.some((r) => r.includes("youtube"))).toBe(true);
  });

  it("名称直击得分最高", () => {
    const result = recommendSkills(skills, "我想用 tdd 的方式开发");
    expect(result[0]?.name).toBe("tdd");
  });

  it("质量警告参与惩罚", () => {
    const noisy = [rec("youtube-clipper", "YouTube 视频智能剪辑。", Array(5).fill("警告"))];
    const clean = [rec("youtube-clipper", "YouTube 视频智能剪辑。")];
    const noisyScore = recommendSkills(noisy, "剪辑 youtube")[0]?.score ?? 0;
    const cleanScore = recommendSkills(clean, "剪辑 youtube")[0]?.score ?? 0;
    expect(cleanScore).toBeGreaterThan(noisyScore);
  });

  it("短名（≤3 字符）不在词边界时不算名称直击", () => {
    // 真实事故：hook 把 "/goal 继续优化" 推荐成 pr——"prompt" 一词含 "pr"
    const prSkill = rec("pr", "创建和审查 pull request，支持 pr 模板与评审流程。");
    const result = recommendSkills([prSkill], "/goal 继续优化 prompt 质量");
    expect(result).toEqual([]);
  });

  it("无关任务不产生推荐", () => {
    expect(recommendSkills(skills, " quantum chromodynamics ")).toEqual([]);
  });

  it("limit 截断", () => {
    const result = recommendSkills(skills, "帮我处理 youtube 和 小红书 和 文章", 2);
    expect(result).toHaveLength(2);
  });
});
