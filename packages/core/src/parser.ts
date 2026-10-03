import fs from "node:fs";
import matter from "gray-matter";

export interface ParsedSkill {
  frontmatter: Record<string, unknown>;
  body: string;
}

/** 解析 SKILL.md 源文本：统一 CRLF，frontmatter 缺失时返回空对象，正文 trim */
export function parseSkillSource(raw: string): ParsedSkill {
  const normalized = raw.replace(/\r\n/g, "\n");
  const parsed = matter(normalized);
  return {
    frontmatter: (parsed.data ?? {}) as Record<string, unknown>,
    body: parsed.content.trim(),
  };
}

/** 从磁盘读取并解析单个 SKILL.md */
export function parseSkillFile(filePath: string): ParsedSkill {
  return parseSkillSource(fs.readFileSync(filePath, "utf8"));
}
