import { describe, expect, it } from "vitest";
import { hashContent, normalizeContent } from "./hash.js";

describe("hashContent", () => {
  it("CRLF 与 LF 内容哈希一致", () => {
    const lf = "---\nname: a\n---\nbody";
    const crlf = "---\r\nname: a\r\n---\r\nbody\r\n";
    expect(hashContent(lf)).toBe(hashContent(crlf));
  });

  it("仅行尾空白差异不改变哈希", () => {
    expect(hashContent("a\nb")).toBe(hashContent("a   \nb\t"));
  });

  it("内容不同哈希不同", () => {
    expect(hashContent("a")).not.toBe(hashContent("b"));
  });
});

describe("normalizeContent", () => {
  it("去掉行尾空白与末尾空行", () => {
    expect(normalizeContent("a \r\nb\t\r\n\r\n")).toBe("a\nb");
  });
});
