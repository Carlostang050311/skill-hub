import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { parseSkillSource } from "./parser.js";
import { computeQuality } from "./quality.js";
import { snapshotDirectory } from "./snapshot.js";
import { replaceSkillDirectory } from "./backups.js";
import type { QualitySignals, SkillRecord } from "./types.js";

export function repairSuggestions(record: SkillRecord): string[] {
  const q = record.quality;
  const suggestions: string[] = [];
  if (!q.hasName) suggestions.push(`在 frontmatter 中补充 name: ${record.dirName}`);
  if (!record.description.trim()) suggestions.push("补充 description，明确输入、任务和不适用场景");
  if (q.descriptionTruncatedRisk) suggestions.push("将 description 压缩到 250 字符以内，先写核心触发条件，把详细说明移到正文");
  if (!q.nameMatchesDir) suggestions.push("核对名称与目录身份；编辑器保留技能身份，目录重命名需另外处理");
  if (!q.nameFormatOk) suggestions.push("名称应使用小写字母、数字和连字符；身份调整需同时核对调用方");
  if (q.bodyTooThin) suggestions.push("补充输入要求、具体步骤、验收条件和失败处理，避免只有一句泛化指令");
  for (const ref of q.missingResourceRefs) suggestions.push(`检查资源引用 ${ref}：恢复真实文件，或修改为实际存在的路径，不虚构资源`);
  return suggestions;
}

export interface EditPreview {
  expectedHash: string;
  before: string;
  after: string;
  beforeQuality: QualitySignals;
  afterQuality: QualitySignals;
  warningDelta: number;
}

export function previewSkillEdit(record: SkillRecord, raw: string): EditPreview {
  if (raw.length > 500000) throw new Error("指导书超过编辑器的 500000 字符上限");
  const after = raw.replace(/\r\n/g, "\n");
  const parsed = parseSkillSource(after);
  if (parsed.frontmatter.name !== record.name) throw new Error("编辑器保留技能 name，请先核对身份，不能在此重命名");
  const snapshot = snapshotDirectory(record.skillDir);
  const files = snapshot.files.filter((f) => f.path !== "SKILL.md").map((f) => f.path);
  const before = fs.readFileSync(record.skillPath, "utf8");
  const original = parseSkillSource(before);
  const input = { dirName: record.dirName, files, skillDir: record.skillDir };
  const beforeQuality = computeQuality({ ...input, frontmatter: original.frontmatter, body: original.body });
  const afterQuality = computeQuality({ ...input, frontmatter: parsed.frontmatter, body: parsed.body });
  return { expectedHash: snapshot.hash, before, after, beforeQuality, afterQuality, warningDelta: afterQuality.warnings.length - beforeQuality.warnings.length };
}

export function applySkillEdit(record: SkillRecord, raw: string, expectedHash: string, stateRoot: string): { hash: string; backupId?: string; preview: EditPreview } {
  const preview = previewSkillEdit(record, raw);
  if (preview.expectedHash !== expectedHash) throw new Error("skill 在预览后发生变化，请重新预览");
  const candidate = path.join(stateRoot, "edits", randomUUID());
  fs.mkdirSync(path.dirname(candidate), { recursive: true });
  fs.cpSync(record.skillDir, candidate, { recursive: true });
  fs.writeFileSync(path.join(candidate, "SKILL.md"), preview.after, "utf8");
  const result = replaceSkillDirectory(candidate, record.skillDir, path.join(stateRoot, "backups"), expectedHash);
  return { hash: snapshotDirectory(record.skillDir).hash, backupId: result.backupId, preview };
}
