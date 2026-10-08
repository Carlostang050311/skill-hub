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
assert.ok(path.resolve(info.runDir).startsWith(path.join(repo, ".skillhub") + path.sep));
assert.ok(path.resolve(info.home).startsWith(path.resolve(info.runDir) + path.sep));
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
  const realCli = JSON.parse(execFileSync(process.execPath, [path.join(repo, "packages", "cli", "dist", "cli.js"), "scan", "--home", os.homedir(), "--json"], { cwd: repo, encoding: "utf8" }));
  const groups = new Map();
  for (const record of realCli.skills) { const rows = groups.get(record.name) ?? []; rows.push(record); groups.set(record.name, rows); }
  evidence.realInventory = { scannedAt: realCli.scannedAt, records: realCli.skills.length, uniqueNames: groups.size, duplicateGroups: [...groups.values()].filter((rows) => rows.length > 1).length, drift: [...groups.values()].filter((rows) => rows.length > 1 && new Set(rows.map((row) => row.hash)).size > 1).length, warnings: realCli.skills.reduce((count, row) => count + row.warnings.length, 0), failed: realCli.roots.reduce((count, root) => count + root.failed, 0), roots: realCli.roots };
  assert.ok(evidence.realInventory.records > 0);
  done("真实本机 CLI 扫描，只读统计与解析失败明细留存");
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
  await navigate(base + "/eval");
  await page.getByRole("heading", { name: "触发范围重叠提醒", exact: true }).waitFor();
  await page.getByText("描述相似 100%", { exact: true }).waitFor();
  await page.screenshot({ path: path.join(output, "fixture-collisions.png"), fullPage: true });
  assert.ok(cli("collisions").some((pair) => [pair.a, pair.b].includes("report-maker") && [pair.a, pair.b].includes("report-checker")));
  done("体检页黄色重叠警示与 CLI 碰撞检测一致");

  const hook = path.join(repo, "scripts", "hook", "prompt-recommend.mjs");
  const hookInput = { agentName: "main", cwd: path.join(os.tmpdir(), "skillhub-hook-fixture-project"), prompt: "请制作一份学术幻灯片和演示文稿" };
  const callHook = (input) => execFileSync(process.execPath, [hook], { cwd: repo, env: { ...process.env, SKILLHUB_HOME: info.home }, input: JSON.stringify(input), encoding: "utf8" });
  assert.equal(callHook({ ...hookInput, agentName: "zcode-workflow" }), "");
  assert.equal(callHook({ ...hookInput, cwd: repo }), "");
  const injected = JSON.parse(callHook(hookInput));
  assert.equal(injected.hookSpecificOutput.hookEventName, "UserPromptSubmit");
  assert.ok(injected.hookSpecificOutput.additionalContext.includes("academic-pptx"));
  assert.ok(injected.hookSpecificOutput.additionalContext.includes("指导书要点"));
  assert.equal(callHook(hookInput), "");
  done("真实 Hook 普通输入注入、子代理/自家仓库零输出与重复抑制");
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

  const corruptId = "11111111-1111-1111-1111-111111111111";
  const corruptDir = path.join(state, "backups", corruptId); fs.mkdirSync(corruptDir, { recursive: true });
  fs.writeFileSync(path.join(corruptDir, "backup.json"), '{"id":');
  const archived = path.join(info.runDir, "archived-claude");
  assert.ok(path.resolve(claude).startsWith(path.resolve(info.runDir) + path.sep));
  assert.ok(path.resolve(archived).startsWith(path.resolve(info.runDir) + path.sep));
  fs.renameSync(claude, archived);
  const backupListing = await api("/api/backups");
  assert.equal(backupListing.recoveryErrors.length, 1);
  assert.ok(backupListing.backups.length > 0);
  const restore = backupListing.backups.find((backup) => backup.targetPath === claude && backup.originalHash === old);
  assert.ok(restore);
  const missingPreview = await api(`/api/backups?id=${restore.id}`);
  assert.equal(missingPreview.targetHash, null);
  assert.ok(missingPreview.differences.every((file) => file.status === "added"));
  await navigate(base + "/sync");
  await page.getByRole("status").filter({ hasText: corruptId }).waitFor();
  await api("/api/backups", { id: restore.id, expectedCurrentHash: null });
  assert.equal(snapshotDirectory(claude).hash, old);
  const archivedCli = path.join(info.runDir, "archived-claude-cli");
  assert.ok(path.resolve(archivedCli).startsWith(path.resolve(info.runDir) + path.sep));
  fs.renameSync(claude, archivedCli);
  cli("restore", restore.id, "--target-missing");
  assert.equal(snapshotDirectory(claude).hash, old);
  assert.equal(fs.readFileSync(path.join(corruptDir, "backup.json"), "utf8"), '{"id":');
  done("坏备份可见提示不阻断列表；Web/CLI 缺失目标预览并恢复，原现场保留");

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

  const brokenScenario = path.join(state, "scenarios", "broken.yaml"); fs.writeFileSync(brokenScenario, "skill: [");
  const healthyConfig = await api("/api/eval");
  assert.ok(healthyConfig.recoveryErrors.some((error) => error.includes("local/broken.yaml")));
  assert.ok(healthyConfig.scenarios.some((scenario) => scenario.skill === "report-maker"));
  await navigate(base + "/workbench?skill=report-maker");
  await page.getByRole("status").filter({ hasText: "local/broken.yaml" }).waitFor();
  await start(); await taskSettled("已完成");
  assert.equal(fs.readFileSync(brokenScenario, "utf8"), "skill: [");
  done("坏用例显示文件级错误，健康 API 任务仍可完成与评分");

  const localPost = await fetch(base + "/api/eval", { method: "POST", headers: { "content-type": "application/json", host: `attacker.example:${info.port}`, origin: `http://attacker.example:${info.port}` }, body: JSON.stringify({ action: "cancel", id: custom.id }) });
  assert.equal(localPost.status, 400);
  assert.equal((await api(`/api/eval?id=${custom.id}`)).status, "awaiting-results");
  done("真实 HTTP 伪造远程 Host/Origin 写入被拒绝");

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
  const nextExecJobs = path.join(state, "exec-next-jobs.jsonl");
  evalCli("exec", "plan", "--scenarios", execCases, "--from", "claude", "--out", nextExecJobs, "--sandbox", path.join(info.runDir, "sandbox"));
  const nextExecJob = JSON.parse(fs.readFileSync(nextExecJobs, "utf8").trim());
  assert.notEqual(nextExecJob.sandboxDir, execJob.sandboxDir);
  const noArtifact = evalCli("exec", "ingest", "--scenarios", execCases, "--jobs", nextExecJobs, "--judge-results", judgeResults);
  assert.equal(noArtifact.results[0].accepted, false);
  assert.equal(fs.existsSync(path.join(execJob.sandboxDir, "report.json")), true);
  done("连续两轮真实 CLI 执行：无新产物拒绝通过，旧产物仍保留");
  fs.writeFileSync(path.join(claude, "later.txt"), "resource changed after execution");
  const stale = evalCli("exec", "ingest", "--scenarios", execCases, "--jobs", execJobs, "--judge-results", judgeResults); assert.equal(stale.results[0].accepted, false); assert.equal(stale.results[0].status, "stale");
  await navigate(base + "/eval"); await page.getByText("版本已变化，需要复测", { exact: true }).first().waitFor();
  done("真实 CLI 执行产物 JSON 检查、入库指纹绑定与资源改动后的 stale 展示");
  const historical = JSON.parse(fs.readFileSync(path.join(state, "tasks", `${after.id}.json`), "utf8"));
  const currentView = await api(`/api/eval?id=${after.id}`);
  assert.equal(historical.report.results[0].status, "complete");
  assert.equal(currentView.report.results[0].status, "stale");
  assert.equal(currentView.report.results[0].overall, null);
  assert.ok((await (await fetch(`${base}/api/eval?id=${after.id}&format=markdown`)).text()).includes("stale"));
  await navigate(base + "/workbench"); await page.getByLabel("评测任务", { exact: true }).selectOption(after.id);
  await page.getByText("版本已变化，需要复测", { exact: false }).first().waitFor();
  await page.screenshot({ path: path.join(output, "fixture-stale-report.png"), fullPage: true });
  done("操作台与导出重新标记过期、隐藏当前总分，历史任务原件保持完整");
  assert.deepEqual(evidence.errors, []);
  done("全部浏览器操作无 console error / pageerror");
} catch (error) {
  await page.screenshot({ path: path.join(output, "failure.png"), fullPage: true });
  evidence.failure = { message: error.message, url: page.url(), text: await page.locator("body").innerText(), selectedTask: await page.getByLabel("评测任务", { exact: true }).inputValue({ timeout: 1000 }).catch(() => "") };
  throw error;
} finally {
  fs.writeFileSync(path.join(output, "evidence.json"), JSON.stringify(evidence, null, 2) + "\n");
  await browser.close();
}
