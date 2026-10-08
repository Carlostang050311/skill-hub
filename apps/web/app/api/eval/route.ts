import { NextResponse } from "next/server";
import { buildJobs, parseResultsFile, exportReport, validateApiUrl } from "@skillhub/eval";
import { hashContent } from "@skillhub/core";
import { evalRunner, scenarioChoices, saveLocalScenario } from "@/lib/workbench";
import { getScan } from "@/lib/data";
import { checkMutationOrigin } from "@/lib/mutations";

export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  try {
    const params = new URL(req.url).searchParams;
    const id = params.get("id");
    if (id) {
      const task = evalRunner().get(id);
      if (params.get("download") === "jobs") return new Response(task.jobs.map((j) => JSON.stringify(j)).join("\n") + "\n", { headers: { "content-type": "application/x-ndjson", "content-disposition": `attachment; filename="eval-jobs-${id}.jsonl"` } });
      const format = params.get("format");
      if (format === "markdown" || format === "html") {
        if (!task.report) throw new Error("任务尚无可导出报告");
        return new Response(exportReport(task.report, format), { headers: { "content-type": format === "html" ? "text/html; charset=utf-8" : "text/markdown; charset=utf-8", "content-disposition": `attachment; filename="report-${id}.${format === "html" ? "html" : "md"}"` } });
      }
      return NextResponse.json(task);
    }
    return NextResponse.json({ recoveryErrors: evalRunner().recoveryErrors, tasks: evalRunner().list().slice(0, 30).map(({ jobs, results, report, ...task }) => ({ ...task, expectedJobs: jobs.length, completedJobs: results.filter((r) => !r.error).length, failedJobs: results.filter((r) => r.error).length, hasReport: Boolean(report) })), scenarios: scenarioChoices().map(({ key, scenario }) => ({ key, skill: scenario.skill, positives: scenario.shouldTrigger.length, negatives: scenario.shouldNotTrigger.length, hash: hashContent(JSON.stringify(scenario)) })), configured: Boolean(process.env.SKILLHUB_API_KEY), model: process.env.SKILLHUB_MODEL ?? "gpt-4o-mini", baseUrl: validateApiUrl(process.env.SKILLHUB_BASE_URL ?? "https://api.openai.com/v1") });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "评测数据读取失败" }, { status: 400 }); }
}

export async function POST(req: Request): Promise<Response> {
  try {
    checkMutationOrigin(req);
    const body = await req.json() as { action?: string; id?: string; results?: string; keys?: string[]; recordIds?: Record<string, string>; backend?: string; model?: string; baseUrl?: string; retryOf?: string; skill?: string; positives?: string; negatives?: string };
    const runner = evalRunner();
    if (body.action === "save-scenario") {
      if (typeof body.skill !== "string" || !getScan().skills.some((r) => r.name === body.skill) || typeof body.positives !== "string" || typeof body.negatives !== "string") throw new Error("请选择本机 skill 并填写正反例");
      const lines = (text: string) => text.split("\n").map((s) => s.trim()).filter(Boolean);
      return NextResponse.json({ key: saveLocalScenario(body.skill, lines(body.positives), lines(body.negatives)) });
    }
    if (body.action === "cancel" && typeof body.id === "string") return NextResponse.json(runner.cancel(body.id));
    if (body.action === "ingest" && typeof body.id === "string" && typeof body.results === "string") return NextResponse.json(runner.ingest(body.id, parseResultsFile(body.results)));
    if (!Array.isArray(body.keys) || !body.keys.length || !["api", "zcode"].includes(body.backend ?? "") || typeof body.model !== "string" || !body.model.trim() || body.model.length > 120) throw new Error("请选择用例、后端和模型");
    const choices = scenarioChoices();
    const selected = body.keys.map((key) => choices.find((c) => c.key === key));
    if (selected.some((c) => !c)) throw new Error("存在未知用例文件");
    const scenarios = selected.map((c) => c!.scenario);
    if (new Set(scenarios.map((s) => s.skill)).size !== scenarios.length) throw new Error("每个 skill 一次只能选择一份用例，避免重复计分");
    const { jobs, skipped } = buildJobs(scenarios, getScan().skills, body.recordIds);
    if (skipped.length) throw new Error(`本机缺少 skill：${skipped.join("、")}`);
    const task = runner.start({ jobs, backend: body.backend as "api" | "zcode", model: body.model.trim(), baseUrl: body.baseUrl, apiKey: process.env.SKILLHUB_API_KEY, retryOf: body.retryOf });
    return NextResponse.json(task, { status: 201 });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "无法启动评测" }, { status: 400 }); }
}
