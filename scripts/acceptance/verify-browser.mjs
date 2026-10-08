import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { chromium } from "playwright";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { snapshotDirectory, replaceSkillDirectory, restoreSkillBackup, defaultRoots, scanAll } from "../../packages/core/dist/index.js";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const info = JSON.parse(fs.readFileSync(path.join(repo, ".skillhub", "acceptance-latest.json"), "utf8"));
const base = `http://127.0.0.1:${info.port}`;
const output = path.join(info.runDir, "browser"); fs.mkdirSync(output, { recursive: true });
const evidence = { fixture: info, checks: [], pages: [], errors: [] };
const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
page.on("pageerror", (error) => evidence.errors.push(error.message));
page.on("console", (message) => { if (message.type() === "error") evidence.errors.push(message.text()); });
function done(name) { evidence.checks.push(name); console.log(`PASS ${name}`); }
async function api(url, body) { const response = await fetch(base + url, body ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : undefined); assert.equal(response.ok, true, await response.clone().text()); return response.json(); }
const cli = (...args) => JSON.parse(execFileSync(process.execPath, [path.join(repo, "packages", "cli", "dist", "cli.js"), ...args, "--home", info.home, "--json"], { cwd: repo, encoding: "utf8" }));
const state = path.join(info.home, ".skillhub");
const agents = path.join(info.home, ".agents", "skills", "report-maker");
const claude = path.join(info.home, ".claude", "skills", "report-maker");
async function navigate(url) { const response = await page.goto(url, { waitUntil: "load" }); assert.equal(response.status(), 200); await page.locator("main h1").first().waitFor(); await page.evaluate(() => document.fonts.ready); }
async function taskSettled(expected) { await page.waitForFunction((status) => document.querySelector('[aria-label="评测任务"]')?.selectedOptions[0]?.textContent.includes(status), expected, { timeout: 20000 }); return api(`/api/eval?id=${await page.getByLabel("评测任务", { exact: true }).inputValue()}`); }
async function start(model = "protocol-fixture", backend = "api") { await page.waitForFunction(() => Boolean(document.querySelector('[aria-label="评测模型"]')?.value)); await page.getByLabel("评测后端", { exact: true }).selectOption(backend); await page.getByLabel("评测模型", { exact: true }).fill(model); await page.getByRole("button", { name: "启动评测", exact: true }).click(); }
try {
  // Real inventory rendering is read-only; all mutation flows below use the isolated home.
  for (const [device, width, height] of [["desktop", 1440, 1000], ["mobile", 390, 844]]) {
    await page.setViewportSize({ width, height });
    for (const route of ["/", "/skills", "/skills/pdf", "/graph", "/sync", "/eval", "/workbench", "/kits"]) {
      await navigate(`http://127.0.0.1:3457${route}`);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
      assert.equal(overflow, false, `${device} overflow ${route}`);
      const filename = `${device}-${route === "/" ? "overview" : route.slice(1).replaceAll("/", "-")}.png`;
      await page.screenshot({ path: path.join(output, filename), fullPage: true });
      evidence.pages.push({ device, route, screenshot: filename });
    }
  }
  done("真实库存 8 页面 × 桌面/移动端渲染、无页面溢出");
  await page.setViewportSize({ width: 1440, height: 1000 });
  const recommendationTask = "制作学术幻灯片";
  const fromCli = cli("recommend", recommendationTask, "--client", "codex");
  const fromWeb = await api(`/api/recommend?${new URLSearchParams({ task: recommendationTask, client: "codex" })}`);
  const client = new Client({ name: "skillhub-acceptance", version: "1.0.0" });
  const transport = new StdioClientTransport({ command: process.execPath, args: [path.join(repo, "packages", "mcp", "dist", "server.js")], env: { ...process.env, SKILLHUB_HOME: info.home } });
  await client.connect(transport);
  const result = await client.callTool({ name: "recommend_skills", arguments: { task: recommendationTask, client: "codex", limit: 5 } });
  const fromMcp = JSON.parse(result.content.find((c) => c.type === "text").text);
  await client.close();
  const identity = (rows) => rows.map(({ name, score, skillId, reasons }) => ({ name, score, skillId, reasons }));
  assert.deepEqual(identity(fromCli), identity(fromWeb)); assert.deepEqual(identity(fromCli), identity(fromMcp));
  await navigate(base + "/skills"); await page.getByLabel("当前任务", { exact: true }).fill(recommendationTask); await page.getByLabel("推荐客户端").selectOption("codex"); await page.getByRole("button", { name: "推荐技能", exact: true }).click(); await page.getByText(`匹配分 ${fromCli[0].score}`, { exact: false }).first().waitFor();
  assert.equal(fromCli[0].name, "academic-pptx"); done("CLI / MCP stdio / Web 推荐身份、分数、理由一致与真实界面提交");

  const old = snapshotDirectory(claude).hash;
  const future = new Date(Date.now() + 60000); fs.utimesSync(path.join(agents, "scripts", "run.mjs"), future, future);
  await navigate(base + "/sync");
  await page.getByRole("button", { name: "对齐最新 · 预览", exact: true }).click();
  await page.getByText("修改 · scripts/run.mjs", { exact: true }).waitFor();
  await page.screenshot({ path: path.join(output, "fixture-sync-preview.png"), fullPage: true });
  assert.equal(snapshotDirectory(claude).hash, old);
  const reload = page.waitForEvent("load"); await page.getByRole("button", { name: "备份并应用", exact: true }).click(); await reload;
  assert.equal(snapshotDirectory(claude).hash, snapshotDirectory(agents).hash);
  await page.getByRole("button", { name: "预览恢复", exact: true }).first().click();
  await page.getByRole("button", { name: "备份当前内容并恢复", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "已恢复" }).waitFor();
  assert.equal(snapshotDirectory(claude).hash, old);
  done("同步逐文件预览无写入 → 应用备份 → Web 恢复完整旧资源");

  await navigate(base + "/workbench?skill=report-maker&recordId=claude%3A%3Areport-maker");
  assert.equal(await page.getByLabel("评测副本 report-maker", { exact: true }).inputValue(), "claude::report-maker");
  await start(); const before = await taskSettled("已完成");
  assert.equal(before.report.results[0].source, "claude"); assert.equal(before.report.completionRate, 100);
  await navigate(base + "/skills/report-maker"); await page.getByLabel("编辑副本", { exact: true }).selectOption("claude::report-maker");
  await page.waitForFunction(() => document.querySelector('[aria-label="指导书源文件"]')?.value.includes("name: report-maker"));
  const original = await page.getByLabel("指导书源文件", { exact: true }).inputValue();
  const repaired = original + "\n## 输入与执行\n核查数据来源，检查单位并保留引用；拒绝凭空添加数据。\n## 验收\n输出报告、数据来源和核查记录。缺失数据时说明缺失位置。\n".repeat(3);
  await page.getByLabel("指导书源文件", { exact: true }).fill(repaired); await page.getByRole("button", { name: "预览修复与质量变化", exact: true }).click();
  await page.getByRole("button", { name: "备份并应用修复", exact: true }).waitFor(); assert.equal(fs.readFileSync(path.join(claude, "SKILL.md"), "utf8"), original);
  await page.screenshot({ path: path.join(output, "fixture-repair-preview.png"), fullPage: true });
  await page.getByRole("button", { name: "备份并应用修复", exact: true }).click(); await page.getByRole("status").filter({ hasText: "修复已应用" }).waitFor();
  await page.getByRole("link", { name: "进入复测 →", exact: true }).click(); await page.getByLabel("评测副本 report-maker", { exact: true }).waitFor();
  assert.equal(await page.getByLabel("评测副本 report-maker", { exact: true }).inputValue(), "claude::report-maker");
  await start(); const after = await taskSettled("已完成");
  assert.equal(after.report.results[0].source, "claude"); assert.notEqual(after.jobs[0].skillHash, before.jobs[0].skillHash); assert.equal(after.jobs[0].scenarioHash, before.jobs[0].scenarioHash);
  assert.ok(after.report.avgOverall > before.report.avgOverall);
  assert.equal(await (await fetch(`${base}/api/eval?id=${after.id}&format=html`)).text().then((s) => s.includes("<!doctype html>")), true);
  assert.ok((await (await fetch(`${base}/api/eval?id=${after.id}&format=markdown`)).text()).includes("report-maker"));
  await page.screenshot({ path: path.join(output, "fixture-eval-complete.png"), fullPage: true });
  await navigate(base + "/eval"); await page.getByText("版本前后对比（相同副本、用例、模型与后端）", { exact: true }).waitFor();
  assert.ok((await page.locator("body").innerText()).includes(before.jobs[0].skillHash));
  assert.ok((await page.locator("body").innerText()).includes(after.jobs[0].skillHash));
  done("修复副本预览与备份 → 同副本复测 → 绑定版本对比 → HTML/Markdown 导出（协议夹具）");

  await navigate(base + "/workbench?skill=report-maker"); await start("protocol-error"); const failure = await taskSettled("需要重试"); assert.equal(failure.report.avgOverall, null);
  await page.getByText("失败原因", { exact: true }).click(); await page.getByText("API HTTP 429", { exact: false }).first().waitFor();
  await page.getByRole("button", { name: "重试未完成作业", exact: true }).click(); const retry = await taskSettled("已完成"); assert.equal(retry.retryOf, failure.id); assert.equal(retry.results.length, 3);
  await start("protocol-slow"); await page.getByRole("button", { name: "取消评测", exact: true }).click(); await taskSettled("已取消");
  done("API HTTP 429 明确失败与重试、在途请求取消（协议夹具）");
  await start("external-test", "zcode"); const external = await taskSettled("等待外部结果");
  const exported = await (await fetch(`${base}/api/eval?id=${external.id}&download=jobs`)).text(); assert.equal(exported.trim().split("\n").length, 3);
  const externalResults = external.jobs.map((j) => ({ id: j.id, raw: JSON.stringify(j.type === "clarity" ? { consistency: 4, actionability: 4, boundedness: 4 } : { trigger: j.expectTrigger }) }));
  await page.getByLabel("评测结果 JSONL", { exact: true }).fill(externalResults.map((r) => JSON.stringify(r)).join("\n"));
  await page.getByRole("button", { name: "导入并生成报告", exact: true }).click(); const imported = await taskSettled("已完成"); assert.equal(imported.report.completionRate, 100);
  await page.getByText("编写或更新本地用例", { exact: true }).click(); await page.getByLabel("应该触发用例", { exact: true }).fill("整理数据报告\n制作数据报告"); await page.getByLabel("不应该触发用例", { exact: true }).fill("今天的天气"); await page.getByRole("button", { name: "保存 report-maker 的本地用例", exact: true }).click(); await page.getByRole("status").filter({ hasText: "本地用例已保存" }).waitFor();
  await start("external-test", "zcode"); const custom = await taskSettled("等待外部结果"); assert.equal(custom.jobs.length, 4); assert.notEqual(custom.jobs[0].scenarioHash, external.jobs[0].scenarioHash);
  done("ZCode JSONL 作业下载与导入、本地正反例保存与重新生成");

  // Actual C: backup / F: target on Windows, plus real CLI execution-artifact ingest.
  const crossBackup = fs.mkdtempSync(path.join(os.tmpdir(), "skillhub-cross-volume-"));
  const crossTarget = path.join(info.runDir, "cross-target"); fs.cpSync(agents, crossTarget, { recursive: true });
  const crossOld = snapshotDirectory(crossTarget).hash;
  const cross = replaceSkillDirectory(claude, crossTarget, crossBackup, crossOld);
  restoreSkillBackup(crossBackup, cross.backupId, [info.runDir]); assert.equal(snapshotDirectory(crossTarget).hash, crossOld);
  evidence.crossVolume = { target: crossTarget, backups: crossBackup }; done("真实 Windows 跨盘备份与恢复");

  const execCases = path.join(info.runDir, "exec-cases"); fs.mkdirSync(execCases);
  const execScenario = { skill: "report-maker", should_trigger: ["制作数据报告"], should_not_trigger: ["今天的天气"], execute: { task: "输出 JSON 数据报告", artifacts: ["report.json"], rubric: ["输出报告"], checks: [{ type: "json", file: "report.json" }] } };
  fs.writeFileSync(path.join(execCases, "report-maker.yaml"), JSON.stringify(execScenario));
  const execJobs = path.join(state, "exec-jobs.jsonl"); const judgeResults = path.join(state, "judge-results.jsonl");
  const evalCli = (...args) => JSON.parse(execFileSync(process.execPath, [path.join(repo, "apps", "eval", "dist", "cli.js"), ...args, "--home", info.home, "--json"], { cwd: repo, encoding: "utf8" }));
  evalCli("exec", "plan", "--scenarios", execCases, "--from", "claude", "--out", execJobs, "--sandbox", path.join(info.runDir, "sandbox"));
  const execJob = JSON.parse(fs.readFileSync(execJobs, "utf8").trim()); fs.writeFileSync(path.join(execJob.sandboxDir, "report.json"), '{"source":"fixture"}');
  fs.writeFileSync(judgeResults, JSON.stringify({ id: "exec-judge:report-maker", raw: JSON.stringify({ rubric: [{ item: "输出报告", pass: true, evidence: "fixture" }] }) }) + "\n");
  const actual = evalCli("exec", "ingest", "--scenarios", execCases, "--jobs", execJobs, "--judge-results", judgeResults); assert.equal(actual.results[0].accepted, true); assert.equal(actual.results[0].status, "bound");
  fs.writeFileSync(path.join(claude, "later.txt"), "resource changed after execution");
  const stale = evalCli("exec", "ingest", "--scenarios", execCases, "--jobs", execJobs, "--judge-results", judgeResults); assert.equal(stale.results[0].accepted, false); assert.equal(stale.results[0].status, "stale");
  await navigate(base + "/eval"); await page.getByText("版本已变化，需要复测", { exact: true }).first().waitFor();
  done("真实 CLI 执行产物 JSON 检查、入库指纹绑定与资源改动后的 stale 展示");
  assert.deepEqual(evidence.errors, []);
  done("全部浏览器操作无 console error / pageerror");
} catch (error) {
  await page.screenshot({ path: path.join(output, "failure.png"), fullPage: true });
  evidence.failure = { message: error.message, url: page.url(), text: await page.locator("body").innerText(), selectedTask: await page.getByLabel("评测任务", { exact: true }).inputValue().catch(() => "") };
  throw error;
} finally {
  fs.writeFileSync(path.join(output, "evidence.json"), JSON.stringify(evidence, null, 2) + "\n");
  await browser.close();
}
