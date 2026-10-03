import { describe, expect, it } from "vitest";
import { parseSkillSource } from "./parser.js";

describe("parseSkillSource", () => {
  it("解析标准 frontmatter 与正文", () => {
    const r = parseSkillSource("---\nname: demo-skill\ndescription: 一个测试\nlicense: MIT\n---\n\n# 正文\n内容");
    expect(r.frontmatter.name).toBe("demo-skill");
    expect(r.frontmatter.description).toBe("一个测试");
    expect(r.frontmatter.license).toBe("MIT");
    expect(r.body).toContain("# 正文");
  });

  it("统一 CRLF 换行", () => {
    const r = parseSkillSource("---\r\nname: crlf-skill\r\ndescription: ok\r\n---\r\n\r\nbody line\r\n");
    expect(r.frontmatter.name).toBe("crlf-skill");
    expect(r.body).toBe("body line");
  });

  it("无 frontmatter 时返回空对象", () => {
    const r = parseSkillSource("只有正文");
    expect(Object.keys(r.frontmatter)).toHaveLength(0);
    expect(r.body).toBe("只有正文");
  });

  it("description 含冒号与引号也能解析", () => {
    const r = parseSkillSource('---\nname: tricky\ndescription: "用途: 含冒号与 \\"引号\\""\n---\nbody');
    expect(r.frontmatter.name).toBe("tricky");
    expect(String(r.frontmatter.description)).toContain("冒号");
  });

  it("正文首尾空白被 trim", () => {
    const r = parseSkillSource("---\nname: t\n---\n\n\nhello\n\n\n");
    expect(r.body).toBe("hello");
  });
});
