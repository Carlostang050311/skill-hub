import type { RunReport } from "./types.js";

const escapeHtml = (text: string): string => text.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
const escapeCell = (text: string): string => text.replaceAll("|", "\\|").replaceAll("\n", " ");

export function exportReport(report: RunReport, format: "markdown" | "html"): string {
  const rows = report.results.map((r) => [r.skill, r.status ?? "旧报告：完整性未验证", r.skillHash ?? "版本未绑定", r.completionRate == null ? "未记录" : `${r.completionRate}%`, r.overall == null ? "—" : String(r.overall), String(r.errors), r.issues.join("；")]);
  const headers = ["Skill", "状态", "内容指纹", "完成率", "总分", "错误", "问题"];
  const title = `skill-hub 评测报告 · ${report.startedAt}`;
  const metadata = `后端：${report.backend}；模型：${report.model ?? "未记录"}；平均总分：${report.avgOverall ?? "—"}`;
  if (format === "markdown") return `# ${title}\n\n${metadata}\n\n| ${headers.join(" | ")} |\n| ${headers.map(() => "---").join(" | ")} |\n${rows.map((r) => `| ${r.map(escapeCell).join(" | ")} |`).join("\n")}\n`;
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><style>body{font:15px system-ui;padding:24px;color:#172033}table{border-collapse:collapse;width:100%}th,td{border:1px solid #ccd3de;padding:10px;text-align:left;vertical-align:top}th{background:#f1f4f8}td{overflow-wrap:anywhere}</style><h1>${escapeHtml(title)}</h1><p>${escapeHtml(metadata)}</p><div style="overflow:auto"><table><thead><tr>${headers.map((h) => `<th>${escapeHtml(h)}</th>`).join("")}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((v) => `<td>${escapeHtml(v)}</td>`).join("")}</tr>`).join("")}</tbody></table></div></html>`;
}
