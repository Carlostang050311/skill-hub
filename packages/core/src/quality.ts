import fs from "node:fs";
import path from "node:path";
import type { QualitySignals } from "./types.js";

/** 部分客户端（如 ZCode）会把超长 description 截断，阈值约 250 字符 */
const DESCRIPTION_TRUNCATE_LIMIT = 250;
const THIN_BODY_CHARS = 100;

export interface QualityInput {
  frontmatter: Record<string, unknown>;
  body: string;
  dirName: string;
  files: string[];
  skillDir: string;
}

const MARKDOWN_LINK_RE = /\[[^\]]*\]\(([^)\s]+)\)/g;
const PLAIN_RELATIVE_RE = /(?:^|[\s"'`(])(\.{1,2}\/[A-Za-z0-9._\-/]+)/g;
const EXTERNAL_RE = /^(https?:|mailto:|data:)/i;

function findMissingResourceRefs(body: string, files: string[], skillDir: string): string[] {
  const candidates = new Set<string>();
  for (const m of body.matchAll(MARKDOWN_LINK_RE)) {
    if (m[1]) candidates.add(m[1]);
  }
  for (const m of body.matchAll(PLAIN_RELATIVE_RE)) {
    if (m[1]) candidates.add(m[1]);
  }
  const fileSet = new Set(files);
  const missing = new Set<string>();
  for (const raw of candidates) {
    let target = raw;
    const hash = target.indexOf("#");
    if (hash > 0) target = target.slice(0, hash);
    const query = target.indexOf("?");
    if (query > 0) target = target.slice(0, query);
    if (!target || EXTERNAL_RE.test(target) || target.startsWith("/")) continue;
    const looksRelative =
      target.startsWith("./") || target.startsWith("../") || /\.[A-Za-z0-9]+$/.test(target);
    if (!looksRelative) continue;
    let decoded = target;
    try {
      decoded = decodeURIComponent(target);
    } catch {
      // 含非法百分号编码时按原样检查
    }
    const resolved = path.resolve(skillDir, decoded);
    const rel = path.relative(skillDir, resolved).split(path.sep).join("/");
    if (rel === "" || rel.startsWith("../")) {
      // 指向 skill 目录之外（如跨 skill 链接），只做存在性检查
      if (!fs.existsSync(resolved)) missing.add(raw);
      continue;
    }
    if (!fileSet.has(rel) && !fs.existsSync(resolved)) missing.add(raw);
  }
  return [...missing];
}

/** 静态质量信号：不调用模型，纯 lint 级检查 */
export function computeQuality(input: QualityInput): QualitySignals {
  const { frontmatter, body, dirName, files, skillDir } = input;
  const name = typeof frontmatter.name === "string" ? frontmatter.name : "";
  const description = typeof frontmatter.description === "string" ? frontmatter.description : "";
  const warnings: string[] = [];

  const hasName = name.trim().length > 0;
  if (!hasName) warnings.push("frontmatter 缺少 name 字段");
  const nameMatchesDir = name.toLowerCase() === dirName.toLowerCase();
  if (hasName && !nameMatchesDir) {
    warnings.push(`name（${name}）与目录名（${dirName}）不一致`);
  }
  const nameFormatOk = /^[a-z0-9][a-z0-9-]*$/.test(name);
  if (hasName && !nameFormatOk) warnings.push(`name 不符合小写连字符规范：${name}`);

  const descriptionChars = description.length;
  if (descriptionChars === 0) warnings.push("frontmatter 缺少 description 字段");
  const descriptionTruncatedRisk = descriptionChars > DESCRIPTION_TRUNCATE_LIMIT;
  if (descriptionTruncatedRisk) {
    warnings.push(
      `description 长 ${descriptionChars} 字符，超过部分客户端约 ${DESCRIPTION_TRUNCATE_LIMIT} 字符的截断阈值，尾部可能被丢弃`,
    );
  }

  const bodyChars = body.length;
  const bodyTooThin = bodyChars < THIN_BODY_CHARS;
  if (bodyTooThin) warnings.push(`正文仅 ${bodyChars} 字符，内容过薄`);

  const missingResourceRefs = findMissingResourceRefs(body, files, skillDir);
  for (const ref of missingResourceRefs) warnings.push(`引用的本地资源不存在：${ref}`);

  return {
    hasName,
    nameMatchesDir,
    nameFormatOk,
    descriptionChars,
    descriptionTruncatedRisk,
    bodyChars,
    bodyTooThin,
    missingResourceRefs,
    resourceFileCount: files.length,
    warnings,
  };
}
