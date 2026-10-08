import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultRoots, scanAll } from "@skillhub/core";
import { EvalTaskRunner, validateApiUrl, type EvalTask } from "./runner.js";
import { buildJobs } from "./jobs.js";
import { scoreRun } from "./score.js";
import { exportReport } from "./report-export.js";
import type { Scenario } from "./types.js";

const dirs: string[] = [];
const servers: http.Server[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const server of servers.splice(0)) { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); }
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function fixture() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "skillhub-runner-")); dirs.push(home);
  const dir = path.join(home, ".agents", "skills", "demo"); fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "SKILL.md"), "---\nname: demo\ndescription: 数据报告\n---\n" + "说明".repeat(80));
  const scenarios: Scenario[] = [{ skill: "demo", shouldTrigger: ["数据报告"], shouldNotTrigger: ["天气"] }];
  const records = scanAll(defaultRoots(home)).skills;
  const jobs = buildJobs(scenarios, records).jobs;
  const root = path.join(home, "tasks");
  let saved = 0;
  const score = (task: EvalTask) => scoreRun(scenarios, scanAll(defaultRoots(home)).skills, task.jobs, task.results, task.createdAt, task.backend, task.model);
  return { home, root, jobs, score, runner: new EvalTaskRunner(root, score, () => { saved += 1; }), saved: () => saved };
}

async function provider(respond: (index: number, data: { messages: Array<{ content: string }> }, response: http.ServerResponse) => void) {
  let count = 0;
  const server = http.createServer((request, response) => {
    let text = ""; request.on("data", (chunk) => { text += String(chunk); });
    request.on("end", () => respond(++count, JSON.parse(text), response));
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as { port: number };
  return { url: `http://127.0.0.1:${address.port}/v1`, count: () => count };
}
function modelResponse(data: { messages: Array<{ content: string }> }, response: http.ServerResponse) {
  const prompt = data.messages[0]!.content;
  const output = prompt.includes("consistency") ? { consistency: 5, actionability: 5, boundedness: 5, issues: [] } : { trigger: !prompt.includes("天气") };
  response.setHeader("content-type", "application/json");
  response.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(output) } }], usage: { total_tokens: 12 } }));
}

describe("评测跑批状态与协议", () => {
  it("首次持久化失败不留下无法取消或重试的运行中任务", () => {
    const { runner, jobs } = fixture();
    vi.spyOn(fs, "writeFileSync").mockImplementation(() => { throw new Error("fixture disk EIO private-test-key"); });
    expect(() => runner.start({ jobs, backend: "api", model: "fixture", apiKey: "private-test-key" })).toThrow(/持久化失败/);
    expect(runner.list()).toHaveLength(0);
    vi.restoreAllMocks();
    expect(runner.start({ jobs, backend: "zcode", model: "fixture" }).status).toBe("awaiting-results");
  });
  it("持续写盘失败保留内存失败状态，不产生未处理 rejection", async () => {
    const { runner, root, jobs } = fixture();
    const api = await provider((_index, data, response) => modelResponse(data, response));
    const task = runner.start({ jobs, backend: "api", model: "fixture", baseUrl: api.url, apiKey: "private-test-key" });
    const write = fs.writeFileSync.bind(fs);
    vi.spyOn(fs, "writeFileSync").mockImplementation((file, data, options) => {
      if (path.dirname(String(file)) === root) throw Object.assign(new Error("fixture disk EIO private-test-key"), { code: "EIO" });
      write(file, data, options);
    });
    await expect(runner.wait(task.id)).resolves.toMatchObject({ status: "failed" });
    expect(runner.get(task.id).error).toContain("持久化失败");
    expect(runner.get(task.id).error).not.toContain("private-test-key");
    await new Promise((resolve) => setImmediate(resolve));
  });
  it("真实 HTTP 请求、逐条进度、报告入库回调和失败重试；不会保存凭据", async () => {
    const { runner, root, jobs, saved } = fixture();
    const api = await provider((index, data, response) => { if (index === 2) { response.statusCode = 429; response.end("limited"); } else modelResponse(data, response); });
    const task = runner.start({ jobs, backend: "api", model: "test-model", baseUrl: api.url, apiKey: "private-test-key" });
    await runner.wait(task.id);
    expect(task.status).toBe("failed");
    expect(task.results[1]?.error).toBe("API HTTP 429");
    expect(task.report?.results[0]?.overall).toBeNull();
    expect(saved()).toBe(1);
    expect(fs.readFileSync(path.join(root, `${task.id}.json`), "utf8")).not.toContain("private-test-key");
    const retry = runner.start({ jobs, backend: "api", model: "test-model", baseUrl: api.url, apiKey: "private-test-key", retryOf: task.id });
    await runner.wait(retry.id);
    expect(api.count()).toBe(4);
    expect(retry.status).toBe("completed");
    expect(retry.report?.completionRate).toBe(100);
    expect(retry.results.reduce((n, r) => n + (r.tokens ?? 0), 0)).toBe(36);
  });
  it("取消在途请求，保存已完成结果；服务重启明确标识中断", async () => {
    const { runner, root, jobs, score } = fixture();
    let entered!: () => void;
    const entry = new Promise<void>((resolve) => { entered = resolve; });
    const api = await provider((_index, _data, _response) => { entered(); });
    const task = runner.start({ jobs, backend: "api", model: "model", baseUrl: api.url, apiKey: "key" });
    await entry; runner.cancel(task.id); await runner.wait(task.id);
    expect(task.status).toBe("cancelled");
    const stale = runner.start({ jobs, backend: "zcode", model: "zcode" });
    fs.writeFileSync(path.join(root, `${stale.id}.json`), JSON.stringify({ ...stale, status: "running" }));
    const reloaded = new EvalTaskRunner(root, score);
    expect(reloaded.get(stale.id).status).toBe("interrupted");
  });
  it("ZCode 作业交换验证作业归属，缺失结果不算成功", () => {
    const { runner, jobs } = fixture();
    const task = runner.start({ jobs, backend: "zcode", model: "zcode-model" });
    expect(task.status).toBe("awaiting-results");
    expect(() => runner.ingest(task.id, [{ id: "outside", raw: "{}" }])).toThrow(/本任务之外/);
    runner.ingest(task.id, [{ id: jobs[0]!.id, raw: '{"consistency":5,"actionability":5,"boundedness":5}' }]);
    expect(task.status).toBe("failed");
    expect(task.report?.results[0]?.completionRate).toBe(33);
    expect(() => runner.start({ jobs, backend: "api", model: "model" })).toThrow(/SKILLHUB_API_KEY/);
  });
  it("损坏任务不会阻断其他任务恢复，原文件保留且可报告", () => {
    const { runner, root, jobs, score } = fixture();
    const good = runner.start({ jobs, backend: "zcode", model: "zcode" });
    const broken = "11111111-1111-1111-1111-111111111111.json";
    fs.writeFileSync(path.join(root, broken), '{"id":');
    const restored = new EvalTaskRunner(root, score);
    expect(restored.get(good.id).status).toBe("awaiting-results");
    expect(restored.recoveryErrors[0]).toContain(broken);
    expect(fs.readFileSync(path.join(root, broken), "utf8")).toBe('{"id":');
  });
  it("模型更换不复用旧结果；HTML 导出转义模型内容", async () => {
    const { runner, jobs } = fixture();
    const api = await provider((_index, data, response) => modelResponse(data, response));
    const first = runner.start({ jobs, backend: "api", model: "a", baseUrl: api.url, apiKey: "key" }); await runner.wait(first.id);
    const second = runner.start({ jobs, backend: "api", model: "b", baseUrl: api.url, apiKey: "key", retryOf: first.id }); await runner.wait(second.id);
    expect(api.count()).toBe(6);
    const report = second.report!; report.results[0]!.issues = ['<script>alert("x")</script>', "A|B"];
    expect(exportReport(report, "html")).not.toContain("<script>");
    expect(exportReport(report, "markdown")).toContain("A\\|B");
    expect(() => validateApiUrl("https://user:password@example.org/v1")).toThrow(/凭据/);
  });
});
