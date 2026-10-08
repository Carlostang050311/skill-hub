import Link from "next/link";
import fs from "node:fs";
import path from "node:path";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { SKILL_PACKS } from "@skillhub/core";
import { Card, SectionTitle, Badge } from "@/components/ui";
import { getScan } from "@/lib/data";
import { projectRoot } from "@/lib/paths";

export const dynamic = "force-dynamic";
const CASES = [{ id: "resource-drift", title: "正文相同，资源不同" }, { id: "partial-score", title: "缺失结果不再获得完整总分" }, { id: "artifact-evidence", title: "模型满分，产物却不存在" }];
export default function KitsPage() {
  const available = new Set(getScan().skills.map((s) => s.name));
  return <div className="mx-auto max-w-5xl space-y-6"><header><h1 className="text-2xl font-semibold text-slate-100">场景技能包与评测案例</h1><p className="mt-1 text-sm text-slate-500">按任务组合本机技能，查看可复现的失败与修复案例。组合示例不是预先评定的质量成绩。</p></header>
    {SKILL_PACKS.map((pack) => <Card key={pack.id}><SectionTitle>{pack.title}</SectionTitle><p className="mb-3 text-sm text-slate-400">{pack.task}</p><div className="mb-4 flex flex-wrap gap-2">{pack.skills.map((name) => available.has(name) ? <Link key={name} href={`/skills/${encodeURIComponent(name)}`}><Badge tone="violet">{name} · 已安装</Badge></Link> : <Badge key={name} tone="amber">{name} · 本机缺少</Badge>)}</div><ol className="mb-3 list-inside list-decimal space-y-1 text-xs text-slate-300">{pack.steps.map((step) => <li key={step}>{step}</li>)}</ol><p className="mb-3 rounded-md bg-slate-950 p-3 text-xs text-slate-400">任务示例：{pack.example}</p><p className="text-xs text-slate-500">验收：{pack.acceptance.join("；")}</p></Card>)}
    <Card><SectionTitle>失败与修复案例库</SectionTitle><p className="mb-3 text-xs text-slate-500">以下案例来自本项目可复现的回归夹具，不冒充真实用户任务的模型成绩。</p><div className="space-y-3">{CASES.map((item) => <details key={item.id} id={item.id} className="rounded-lg border border-slate-800 p-3"><summary className="cursor-pointer text-sm text-violet-300">{item.title}</summary><div className="prose prose-invert prose-sm mt-3 max-w-none"><Markdown remarkPlugins={[remarkGfm]}>{fs.readFileSync(path.join(projectRoot(), "docs", "cases", `${item.id}.md`), "utf8")}</Markdown></div></details>)}</div></Card>
  </div>;
}
