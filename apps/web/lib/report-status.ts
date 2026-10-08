import type { SkillRecord } from "@skillhub/core";
import type { SkillEvalReport } from "@skillhub/eval";

export function reportStatus(report: SkillEvalReport, record?: SkillRecord): "complete" | "incomplete" | "stale" | "unverified" {
  if (!report.skillHash || !report.status) return "unverified";
  if (!record || record.hash !== report.skillHash || report.status === "stale") return "stale";
  return report.status;
}
export const reportStatusLabel = { complete: "完整评测", incomplete: "评测未完成", stale: "版本已变化", unverified: "历史成绩未绑定版本" };
