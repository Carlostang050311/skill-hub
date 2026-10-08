import { Card } from "@/components/ui";
import { EvalWorkbench } from "@/components/EvalWorkbench";
import { getScan } from "@/lib/data";

export const dynamic = "force-dynamic";
export default async function WorkbenchPage({ searchParams }: { searchParams: Promise<{ skill?: string; recordId?: string }> }) {
  const params = await searchParams;
  const records = getScan().skills.map(({ id, name, source }) => ({ id, name, source }));
  const skills = [...new Set(records.map((r) => r.name))].sort();
  return <div className="mx-auto max-w-5xl space-y-6"><header><h1 className="text-2xl font-semibold text-slate-100">评测操作台</h1><p className="mt-1 text-sm text-slate-500">选择任务用例与模型，运行触发和清晰度评测；修复后复测并保留每次报告。</p></header><Card><EvalWorkbench skills={skills} records={records} initialSkill={params.skill} initialRecordId={params.recordId} /></Card></div>;
}
