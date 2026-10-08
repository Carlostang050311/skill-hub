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

  it("固定任务集验证 top-1 和无关任务，包含中英文表达与同义词", () => {
    const bank = [...skills, rec("academic-pptx", "Build academic slides."), rec("prototype", "Build interactive prototypes."), rec("playwright", "Browser automation and screenshots.")];
    const cases = [
      ["做一份演示文稿介绍研究成果", "academic-pptx"],
      ["帮我把文章去AI味", "humanizer-zh"],
      ["把长视频切片", "youtube-clipper"],
      ["先写失败用例，再用测试驱动实现", "tdd"],
      ["为新页面做浏览器验收和截图", "playwright"],
      ["做一个可以点击的原型", "prototype"],
      ["build academic slides", "academic-pptx"],
      ["clip youtube video", "youtube-clipper"],
    ];
    const hits = cases.filter(([query, expected]) => recommendSkills(bank, query!)[0]?.name === expected).length;
    expect(hits).toBe(cases.length);
    expect(recommendSkills(bank, "帮我预测彩票号码")).toEqual([]);
    expect(recommendSkills(bank, "prompt quality quantum chromodynamics")).toEqual([]);
  });

  it("只排除声明不兼容的客户端，未知兼容性明确保留标识", () => {
    const claudeOnly = { ...rec("private-slides", "制作演示文稿"), extraFrontmatter: { skillhub: { clients: ["claude"], aliases: ["PPT"] } } };
    const unknown = rec("academic-pptx", "学术演示文稿");
    const result = recommendSkills([claudeOnly, unknown], "做演示文稿", 5, { client: "codex" });
    expect(result.map((r) => r.name)).toEqual(["academic-pptx"]);
    expect(result[0]?.reasons).toContain("客户端兼容性未声明，请查看指导书");
    expect(result[0]?.skillId).toBe(unknown.id);
  });
});
