import { describe, expect, it } from "vitest";
import { buildContext, extractPrompt } from "./prompt-recommend.mjs";

describe("extractPrompt", () => {
  it("从 hook JSON 的常见字段取 prompt", () => {
    expect(extractPrompt('{"prompt":"帮我做 PPT"}')).toBe("帮我做 PPT");
    expect(extractPrompt('{"user_prompt":"写个脚本"}')).toBe("写个脚本");
    expect(extractPrompt('{"message":"修这个 bug"}')).toBe("修这个 bug");
  });

  it("非 JSON 输入按原始文本处理", () => {
    expect(extractPrompt("帮我做 PPT")).toBe("帮我做 PPT");
    expect(extractPrompt("")).toBe("");
    expect(extractPrompt(null)).toBe("");
  });

  it("JSON 但没有已知字段时返回空（防止键名自匹配）", () => {
    expect(extractPrompt('{"other":1,"prompt2":"x"}')).toBe("");
  });
});

describe("buildContext", () => {
  it("包含 skill 名与匹配分", () => {
    const ctx = buildContext("tdd", 33);
    expect(ctx).toContain("tdd");
    expect(ctx).toContain("33");
    expect(ctx).toContain("skillhub show tdd");
  });
});
