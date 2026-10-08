import { describe, expect, it } from "vitest";
import path from "node:path";
import { buildContext, extractPrompt, parseHookInput, shouldSkip } from "./prompt-recommend.mjs";

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
  it("强匹配正文预取限制为600字符", () => {
    const body = "指导书正文".repeat(200);
    const ctx = buildContext("demo", 50, body);
    expect(ctx).toContain(body.slice(0, 600));
    expect(ctx).not.toContain(body.slice(0, 601));
  });
});

describe("Hook 跳过规则", () => {
  it("识别真实字段，子代理和自家目录跳过，普通项目仍可注入", () => {
    const repo = path.resolve("skill-hub");
    const subagent = parseHookInput(JSON.stringify({ agentName: "zcode-workflow", cwd: path.resolve("other-project"), prompt: "请制作一份学术演示文稿" }));
    expect(subagent.prompt).toBe("请制作一份学术演示文稿");
    expect(shouldSkip(subagent, repo)).toBe(true);
    expect(shouldSkip({ ...subagent, agentName: "main", cwd: path.join(repo, "apps") }, repo)).toBe(true);
    expect(shouldSkip({ ...subagent, agentName: "main" }, repo)).toBe(false);
  });
});
