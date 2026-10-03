import { describe, expect, it } from "vitest";
import { extractReferences } from "./graph.js";

describe("extractReferences", () => {
  it("提取 SKILL.md 链接与 wiki 链接", () => {
    const body = "先看 ../foo/SKILL.md，再读 [[bar]]，外链 https://x.com/a/SKILL.md 不算";
    const refs = extractReferences(body);
    expect(refs).toContain("foo");
    expect(refs).toContain("bar");
    expect(refs).toContain("a");
  });

  it("去重", () => {
    const refs = extractReferences("见 [[foo]] 与 [[foo]] 与 foo/SKILL.md");
    expect(refs).toEqual(["foo"]);
  });

  it("可用已知名单过滤", () => {
    const refs = extractReferences("../foo/SKILL.md 和 [[ghost]]", new Set(["foo"]));
    expect(refs).toEqual(["foo"]);
  });
});
