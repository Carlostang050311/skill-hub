import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { parseModelJson } from "./jobs.js";
import type { EvalJob, JobResult, RunReport } from "./types.js";

export interface EvalTask {
  id: string;
  createdAt: string;
  updatedAt: string;
  status: "running" | "awaiting-results" | "completed" | "failed" | "cancelled" | "interrupted";
  backend: "api" | "zcode";
  model: string;
  baseUrl?: string;
  jobs: EvalJob[];
  results: JobResult[];
  report?: RunReport;
  error?: string;
  retryOf?: string;
}

export function validJobResult(job: EvalJob, result: JobResult): boolean {
  if (result.error) return false;
  const parsed = parseModelJson(result.raw);
  if (!parsed) return false;
  return job.type === "trigger" ? typeof parsed.trigger === "boolean" : [parsed.consistency, parsed.actionability, parsed.boundedness].every((v) => typeof v === "number" && Number.isFinite(v) && v >= 1 && v <= 5);
}

export function validateApiUrl(value: string): string {
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error("API 地址须为 HTTP(S) 地址，不得包含凭据、查询参数或片段");
  return url.href.replace(/\/$/, "");
}

/** 本地长驻 Node 进程的跑批队列；结果逐条落盘，重启后明确标记中断。 */
export class EvalTaskRunner {
  readonly recoveryErrors: string[] = [];
  private tasks = new Map<string, EvalTask>();
  private controllers = new Map<string, AbortController>();
  private pending = new Map<string, Promise<void>>();
  constructor(private root: string, private score: (task: EvalTask) => RunReport, private saveReport: (report: RunReport) => void = () => {}) {
    fs.mkdirSync(root, { recursive: true });
    for (const file of fs.readdirSync(root).filter((f) => /^[a-f0-9-]{36}\.json$/.test(f))) {
      let task: EvalTask;
      try {
        task = JSON.parse(fs.readFileSync(path.join(root, file), "utf8")) as EvalTask;
        if (task.id + ".json" !== file || !Array.isArray(task.jobs) || !Array.isArray(task.results) || !["running", "awaiting-results", "completed", "failed", "cancelled", "interrupted"].includes(task.status)) throw new Error("无效任务结构");
      } catch { this.recoveryErrors.push(`任务文件损坏，已保留原文件：${file}`); continue; }
      if (task.status === "running") { task.status = "interrupted"; task.error = "服务重启，评测中断；可重试未完成作业"; }
      this.tasks.set(task.id, task);
      this.persist(task);
    }
  }
  private persist(task: EvalTask): void {
    task.updatedAt = new Date().toISOString();
    const target = path.join(this.root, `${task.id}.json`);
    const staging = path.join(this.root, `${task.id}.pending`);
    fs.writeFileSync(staging, JSON.stringify(task, null, 2) + "\n", "utf8");
    fs.renameSync(staging, target);
  }
  list(): EvalTask[] { return [...this.tasks.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)); }
  get(id: string): EvalTask { const task = this.tasks.get(id); if (!task) throw new Error("找不到评测任务"); return task; }
  start(input: { jobs: EvalJob[]; backend: "api" | "zcode"; model: string; baseUrl?: string; apiKey?: string; retryOf?: string }): EvalTask {
    if (!input.jobs.length) throw new Error("没有可执行的评测用例");
    if (input.backend === "api" && !input.apiKey) throw new Error("服务器未配置 SKILLHUB_API_KEY，可选择 ZCode 作业交换");
    const baseUrl = input.backend === "api" ? validateApiUrl(input.baseUrl ?? "https://api.openai.com/v1") : undefined;
    const previous = input.retryOf ? this.get(input.retryOf) : undefined;
    if (previous?.status === "running") throw new Error("运行中的任务不能重试");
    const reusable = previous && previous.backend === input.backend && previous.model === input.model && previous.baseUrl === baseUrl;
    const results = reusable ? previous.results.filter((r) => {
      const current = input.jobs.find((j) => j.id === r.id);
      const old = previous.jobs.find((j) => j.id === r.id);
      return current && old && current.skillId === old.skillId && current.skillHash === old.skillHash && current.scenarioHash === old.scenarioHash && validJobResult(current, r);
    }) : [];
    const task: EvalTask = { id: randomUUID(), createdAt: new Date().toISOString(), updatedAt: "", status: input.backend === "api" ? "running" : "awaiting-results", backend: input.backend, model: input.model, baseUrl, jobs: input.jobs, results, retryOf: input.retryOf };
    try { this.persist(task); }
    catch (error) {
      const message = error instanceof Error ? error.message : "写入失败";
      throw new Error(`任务持久化失败：${input.apiKey ? message.replaceAll(input.apiKey, "[redacted]") : message}`);
    }
    this.tasks.set(task.id, task);
    if (input.backend === "api") {
      const controller = new AbortController();
      this.controllers.set(task.id, controller);
      const promise = this.run(task, input.apiKey!, controller);
      this.pending.set(task.id, promise);
      const cleanup = () => { this.pending.delete(task.id); this.controllers.delete(task.id); };
      void promise.then(cleanup, cleanup);
    }
    return task;
  }
  private finish(task: EvalTask): void {
    task.report = this.score(task);
    this.saveReport(task.report);
    task.status = task.report.results.length === new Set(task.jobs.map((j) => j.skill)).size && task.report.results.every((r) => r.status === "complete") ? "completed" : "failed";
    if (task.status === "failed") task.error = "存在缺失、失败或版本已变化的作业，请查看详情并重试";
    this.persist(task);
  }
  private async run(task: EvalTask, key: string, controller: AbortController): Promise<void> {
    try {
      for (const job of task.jobs) {
        if (controller.signal.aborted) break;
        if (task.results.some((r) => r.id === job.id && validJobResult(job, r))) continue;
        const started = Date.now();
        let result: JobResult;
        try {
          const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(60000)]);
          const response = await fetch(`${task.baseUrl}/chat/completions`, { method: "POST", redirect: "error", headers: { "content-type": "application/json", authorization: `Bearer ${key}` }, body: JSON.stringify({ model: task.model, messages: job.messages, temperature: 0 }), signal });
          if (!response.ok) throw new Error(`API HTTP ${response.status}`);
          const data = await response.json() as { choices?: Array<{ message?: { content?: string } }>; usage?: { total_tokens?: number } };
          result = { id: job.id, raw: data.choices?.[0]?.message?.content ?? "", latencyMs: Date.now() - started, tokens: data.usage?.total_tokens };
          if (!validJobResult(job, result)) result.error = "模型输出不符合评测结果格式";
        } catch (error) {
          if (controller.signal.aborted) break;
          result = { id: job.id, raw: "", error: error instanceof Error ? error.message.replaceAll(key, "[redacted]") : "API 请求失败", latencyMs: Date.now() - started };
        }
        task.results = [...task.results.filter((r) => r.id !== job.id), result];
        this.persist(task);
      }
      if (controller.signal.aborted) { task.status = "cancelled"; task.error = "用户取消评测，已完成的结果保留，可重试"; this.persist(task); }
      else this.finish(task);
    } catch (error) {
      task.status = "failed";
      task.error = error instanceof Error ? error.message.replaceAll(key, "[redacted]") : "评测报告保存失败";
      try { this.persist(task); }
      catch (persistError) { task.error += `；状态持久化失败：${persistError instanceof Error ? persistError.message.replaceAll(key, "[redacted]") : "写入失败"}。已完成结果暂存内存，请导出并检查磁盘后重试`; }
    }
  }
  cancel(id: string): EvalTask {
    const task = this.get(id);
    if (task.status === "running") this.controllers.get(id)?.abort();
    if (task.status === "awaiting-results") { task.status = "cancelled"; this.persist(task); }
    return task;
  }
  ingest(id: string, results: JobResult[]): EvalTask {
    const task = this.get(id);
    if (task.backend !== "zcode" || task.status !== "awaiting-results") throw new Error("该任务不接受外部结果");
    const ids = new Set(task.jobs.map((j) => j.id));
    if (results.some((r) => !ids.has(r.id))) throw new Error("结果包含本任务之外的作业编号");
    task.results = [...new Map([...task.results, ...results].map((r) => [r.id, r])).values()];
    this.finish(task);
    return task;
  }
  async wait(id: string): Promise<EvalTask> { await this.pending.get(id); return this.get(id); }
}
