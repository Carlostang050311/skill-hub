#!/usr/bin/env node
import { Command } from "commander";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { defaultRoots, scanAll } from "@skillhub/core";
import { insertRun, getRunReport, latestRun, listRuns, openDb } from "./db.js";
import { ensureSandbox, listSandboxFiles, parseExecReport, parseExecSpec, renderExecutorPrompt, renderJudgePrompt, scoreExec, type ExecSpec } from "./exec.js";
import { buildGenChunks, parseGenResults, renderGenPrompt, scenarioToYaml, toGenItems, uncoveredSkills, writeScenarioFile } from "./gen.js";
import { buildJobs, parseResultsFile } from "./jobs.js";
import { collectLeaderboard, type ExecRunRow } from "./leaderboard.js";
import { loadScenarios } from "./scenario.js";
import { scoreRun } from "./score.js";
import type { EvalJob, JobResult, Scenario } from "./types.js";

const VERSION = "0.1.0";

interface GlobalOpts {
  db?: string;
  home?: string;
  json?: boolean;
}

function defaultDbPath(): string {
  return path.join(os.homedir(), ".skillhub", "eval.db");
}

function scanRecords(home?: string) {
  return scanAll(defaultRoots(home)).skills;
}

function printJson(data: unknown): void {
  console.log(JSON.stringify(data, null, 2));
}

export async function main(argv: string[]): Promise<void> {
  const program = new Command();
  program.name("skillhub-eval").description("skill-hub 评测框架：scenario YAML + 跑批 + 报告入库").version(VERSION);

  const addGlobal = (cmd: Command): void => {
    cmd.option("--db <file>", "SQLite 报告库路径", defaultDbPath()).option("--home <dir>", "覆盖用户主目录").option("--json", "JSON 输出");
  };

  const plan = program.command("plan").description("构建评测作业文件（供 ZCode 子代理或 API 后端执行）");
  addGlobal(plan);
  plan
    .option("--scenarios <dirs>", "scenario YAML 目录（逗号分隔）", "scenarios,scenarios-auto")
    .option("--out <file>", "作业 JSONL 输出路径", ".skillhub/eval-jobs.jsonl")
    .option("--names <list>", "只评这些 skill（逗号分隔）");
  plan.action((opts: { scenarios: string; out: string; names?: string; home?: string; json?: boolean }) => {
    const wanted = opts.names ? new Set(opts.names.split(",").map((s) => s.trim()).filter(Boolean)) : null;
    const scenarios = opts.scenarios.split(",").flatMap((d) => loadScenarios(d.trim())).filter((s) => !wanted || wanted.has(s.skill));
    const { jobs, skipped } = buildJobs(scenarios, scanRecords(opts.home));
    fs.mkdirSync(path.dirname(opts.out), { recursive: true });
    fs.writeFileSync(opts.out, jobs.map((j) => JSON.stringify(j)).join("\n") + "\n", "utf8");
    if (opts.json) {
      printJson({ jobCount: jobs.length, skipped, out: opts.out });
      return;
    }
    console.log(`生成 ${jobs.length} 个作业 → ${opts.out}`);
    if (skipped.length > 0) console.log(`跳过（库中不存在）：${skipped.join(", ")}`);
  });

  const runApi = program.command("run-api").description("用 OpenAI 兼容 API 直接跑批（需 SKILLHUB_API_KEY）");
  addGlobal(runApi);
  runApi
    .option("--scenarios <dir>", "scenario YAML 目录", "scenarios")
    .option("--names <list>", "只评这些 skill（逗号分隔）")
    .option("--base-url <url>", "API base URL", process.env.SKILLHUB_BASE_URL ?? "https://api.openai.com/v1")
    .option("--model <id>", "模型 ID", process.env.SKILLHUB_MODEL ?? "gpt-4o-mini");
  runApi.action(async (opts: { scenarios: string; names?: string; baseUrl: string; model: string; db: string; home?: string }) => {
    const key = process.env.SKILLHUB_API_KEY;
    if (!key) {
      console.error("缺少 SKILLHUB_API_KEY 环境变量；或改用 ZCode 子代理后端：plan → 子代理跑批 → ingest");
      process.exitCode = 1;
      return;
    }
    const scenarios = loadScenarios(opts.scenarios).filter((s) => !opts.names || opts.names.split(",").map((s2) => s2.trim()).includes(s.skill));
    const { jobs } = buildJobs(scenarios, scanRecords(opts.home));
    const results: JobResult[] = [];
    for (const job of jobs) {
      try {
        const resp = await fetch(`${opts.baseUrl}/chat/completions`, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
          body: JSON.stringify({ model: opts.model, messages: job.messages, temperature: 0 }),
        });
        const data = (await resp.json()) as { choices?: Array<{ message?: { content?: string } }> };
        const raw = data.choices?.[0]?.message?.content ?? "";
        results.push({ id: job.id, raw });
      } catch {
        results.push({ id: job.id, raw: "" });
      }
    }
    const report = scoreRun(scenarios, scanRecords(opts.home), jobs, results, new Date().toISOString(), "api", opts.model);
    const runId = insertRun(openDb(opts.db), report);
    console.log(`完成 ${results.length} 个作业，run #${runId} 已入库 → ${opts.db}`);
  });

  const ingest = program.command("ingest").description("回收作业结果并评分入库（ZCode 子代理后端）");
  addGlobal(ingest);
  ingest
    .option("--scenarios <dirs>", "scenario YAML 目录（逗号分隔）", "scenarios,scenarios-auto")
    .option("--names <list>", "只评这些 skill（逗号分隔，与 plan 的过滤一致）")
    .option("--jobs <file>", "作业 JSONL", ".skillhub/eval-jobs.jsonl")
    .option("--results <file>", "结果 JSONL（每行 {id, raw}）", ".skillhub/eval-results.jsonl")
    .option("--model <id>", "实际执行的模型标注", "glm-5.3-flash");
  ingest.action(
    (opts: { scenarios: string; names?: string; jobs: string; results: string; model: string; db: string; home?: string; json?: boolean }) => {
      const wanted = opts.names ? new Set(opts.names.split(",").map((s) => s.trim()).filter(Boolean)) : null;
      const scenarios = opts.scenarios.split(",").flatMap((d) => loadScenarios(d.trim())).filter((s) => !wanted || wanted.has(s.skill));
      const jobs = fs
        .readFileSync(opts.jobs, "utf8")
        .split("\n")
        .filter((l) => l.trim())
        .map((l) => JSON.parse(l) as EvalJob);
      const results = parseResultsFile(fs.readFileSync(opts.results, "utf8"));
      const report = scoreRun(scenarios, scanRecords(opts.home), jobs, results, new Date().toISOString(), "zcode", opts.model);
      const runId = insertRun(openDb(opts.db), report);
      if (opts.json) {
        printJson({ runId, report });
        return;
      }
      console.log(`run #${runId} 已入库（${results.length} 个结果）→ ${opts.db}`);
      console.table(
        report.results.map((r) => ({
          skill: r.skill,
          overall: r.overall,
          触发: r.triggerScore == null ? "—" : `${r.triggerScore}%`,
          过触发: r.falsePositives,
          清晰度: r.clarityScore == null ? "—" : r.clarityScore,
          静态: r.staticScore,
          解析失败: r.errors,
        })),
      );
      console.log(
        `平均：overall ${report.avgOverall ?? "—"} · 触发 ${report.avgTrigger ?? "—"} · 清晰度 ${report.avgClarity ?? "—"} · 静态 ${report.avgStatic}`,
      );
    },
  );

  const reportCmd = program.command("report").description("查看已入库的评测报告");
  addGlobal(reportCmd);
  reportCmd.option("--run <id>", "指定 run id（默认最新）");
  reportCmd.action((opts: { run?: string; db: string; json?: boolean }) => {
    const db = openDb(opts.db);
    const found = opts.run ? getRunReport(db, Number(opts.run)) : latestRun(db);
    if (!found) {
      console.error("没有已入库的评测报告，先跑 plan → 跑批 → ingest");
      process.exitCode = 1;
      return;
    }
    if (opts.json) {
      printJson(found.report);
      return;
    }
    for (const r of listRuns(db)) {
      console.log(`run #${r.id}  ${r.startedAt}  ${r.backend}${r.model ? `/${r.model}` : ""}  ${r.totalSkills} skills  overall ${r.avgOverall ?? "—"}`);
    }
  });

  const exec = program.command("exec").description("执行级评测：skill 真实在沙箱里干活，评审者独立复核");
  const addExecGlobal = (cmd: Command): void => {
    cmd.option("--scenarios <dir>", "scenario YAML 目录", "scenarios-exec").option("--db <file>", "报告库路径", defaultDbPath()).option("--json", "JSON 输出");
  };

  const execPlan = exec.command("plan").description("构建执行作业（每 skill 一个沙箱 + 一条作业）");
  addExecGlobal(execPlan);
  execPlan
    .option("--names <list>", "只执行这些 skill（逗号分隔，必须带 execute 块）")
    .option("--sandbox <dir>", "沙箱根目录", ".skillhub/sandbox")
    .option("--out <file>", "作业 JSONL 输出", ".skillhub/exec-jobs.jsonl");
  execPlan.action((opts: { scenarios: string; names?: string; sandbox: string; out: string; home?: string; json?: boolean }) => {
    const wanted = opts.names ? new Set(opts.names.split(",").map((s) => s.trim())) : null;
    const scenarios = loadScenarios(opts.scenarios).filter((s) => !wanted || wanted.has(s.skill));
    const records = scanRecords(opts.home);
    const jobs: Array<Record<string, unknown>> = [];
    const skipped: string[] = [];
    for (const scenario of scenarios) {
      const spec = parseExecSpec(scenario);
      if (!spec) continue;
      const record = records.filter((r) => r.name === scenario.skill).sort((a, b) => (a.source === "agents" ? -1 : 0) - (b.source === "agents" ? -1 : 0))[0];
      if (!record) {
        skipped.push(scenario.skill);
        continue;
      }
      const sandboxDir = ensureSandbox(opts.sandbox, scenario.skill);
      jobs.push({
        id: `exec:${scenario.skill}`,
        type: "execute",
        skill: scenario.skill,
        messages: [{ role: "user", content: renderExecutorPrompt({ skillPath: record.skillPath, sandboxDir, spec }) }],
        sandboxDir,
        spec,
      });
    }
    fs.mkdirSync(path.dirname(opts.out), { recursive: true });
    fs.writeFileSync(opts.out, jobs.map((j) => JSON.stringify(j)).join("\n") + "\n", "utf8");
    if (opts.json) {
      printJson({ jobCount: jobs.length, skipped, out: opts.out });
      return;
    }
    console.log(`生成 ${jobs.length} 个执行作业 → ${opts.out}`);
    if (skipped.length > 0) console.log(`跳过（库中不存在）：${skipped.join(", ")}`);
  });

  const execJudge = exec.command("judge").description("根据执行者结果构建评审作业（复核 rubric）");
  addExecGlobal(execJudge);
  execJudge
    .option("--jobs <file>", "执行作业 JSONL", ".skillhub/exec-jobs.jsonl")
    .option("--results <file>", "执行结果 JSONL", ".skillhub/exec-results.jsonl")
    .option("--out <file>", "评审作业 JSONL 输出", ".skillhub/exec-judge-jobs.jsonl");
  execJudge.action((opts: { jobs: string; results: string; out: string; json?: boolean }) => {
    const jobs = fs
      .readFileSync(opts.jobs, "utf8")
      .split("\n")
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l) as { id: string; skill: string; spec: ExecSpec; sandboxDir: string });
    const results = parseResultsFile(fs.readFileSync(opts.results, "utf8"));
    const resultMap = new Map(results.map((r) => [r.id, r.raw]));
    const judgeJobs: Array<Record<string, unknown>> = [];
    for (const job of jobs) {
      const raw = resultMap.get(job.id);
      const report = parseExecReport(job.skill, job.sandboxDir, raw ?? "");
      const fileListing = listSandboxFiles(job.sandboxDir);
      judgeJobs.push({
        id: `exec-judge:${job.skill}`,
        type: "execute-judge",
        skill: job.skill,
        messages: [{ role: "user", content: renderJudgePrompt({ skill: job.skill, spec: job.spec, report, fileListing }) }],
      });
    }
    fs.writeFileSync(opts.out, judgeJobs.map((j) => JSON.stringify(j)).join("\n") + "\n", "utf8");
    if (opts.json) {
      printJson({ jobCount: judgeJobs.length, out: opts.out });
      return;
    }
    console.log(`生成 ${judgeJobs.length} 个评审作业 → ${opts.out}`);
  });

  const execIngest = exec.command("ingest").description("汇总评审结果并输出执行级评测报告");
  addExecGlobal(execIngest);
  execIngest
    .option("--jobs <file>", "执行作业 JSONL", ".skillhub/exec-jobs.jsonl")
    .option("--judge-results <file>", "评审结果 JSONL", ".skillhub/exec-judge-results.jsonl")
    .option("--model <id>", "模型标注", "glm-5.3-flash");
  execIngest.action((opts: { jobs: string; judgeResults: string; model: string; json?: boolean }) => {
    const jobs = fs
      .readFileSync(opts.jobs, "utf8")
      .split("\n")
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l) as { id: string; skill: string; spec: ExecSpec });
    const judgeResults = parseResultsFile(fs.readFileSync(opts.judgeResults, "utf8"));
    const judgeMap = new Map(judgeResults.map((r) => [r.id, r.raw]));
    const rows = jobs.map((job) => {
      const result = scoreExec(job.spec, judgeMap.get(`exec-judge:${job.skill}`) ?? "");
      return { skill: job.skill, ...result };
    });
    const runRecord = { runAt: new Date().toISOString(), backend: "zcode-exec", model: opts.model, results: rows };
    const historyFile = path.join(path.dirname(opts.jobs), "exec-runs.json");
    const history: unknown[] = fs.existsSync(historyFile) ? (JSON.parse(fs.readFileSync(historyFile, "utf8")) as unknown[]) : [];
    history.push(runRecord);
    fs.writeFileSync(historyFile, JSON.stringify(history, null, 2), "utf8");
    if (opts.json) {
      printJson(runRecord);
      return;
    }
    console.table(
      rows.map((r) => ({
        skill: r.skill,
        通过: `${r.rubricPassed}/${r.rubricTotal}`,
        得分: r.score,
        解析失败: r.parseError ? 1 : 0,
      })),
    );
    console.log(`run 已追加 → ${historyFile}`);
  });

  const gen = program.command("gen").description("半自动生成 trigger scenario：分块派给子代理产出，回收校验后写入 scenarios-auto（人工过目）");

  const genPlan = gen.command("plan").description("构建生成作业");
  genPlan
    .option("--scenarios <dir>", "已有 scenario 目录（算已覆盖）", "scenarios")
    .option("--auto-dir <dir>", "自动生成 scenario 目录（也算已覆盖）", "scenarios-auto")
    .option("--chunk-size <n>", "每个作业覆盖的 skill 数", "12")
    .option("--out <file>", "作业 JSONL 输出", ".skillhub/gen-jobs.jsonl")
    .option("--home <dir>", "覆盖用户主目录")
    .option("--json", "JSON 输出");
  genPlan.action((opts: { scenarios: string; autoDir: string; chunkSize: string; out: string; home?: string; json?: boolean }) => {
    const covered = new Set([...loadScenarios(opts.scenarios), ...loadScenarios(opts.autoDir)].map((s) => s.skill));
    const uncovered = uncoveredSkills(scanRecords(opts.home), covered);
    const chunks = buildGenChunks(toGenItems(uncovered), Number(opts.chunkSize) || 12);
    const jobs = chunks.map((chunk) => ({
      id: chunk.id,
      type: "gen",
      messages: [{ role: "user", content: renderGenPrompt(chunk) }],
    }));
    fs.mkdirSync(path.dirname(opts.out), { recursive: true });
    fs.writeFileSync(opts.out, jobs.map((j) => JSON.stringify(j)).join("\n") + "\n", "utf8");
    if (opts.json) {
      printJson({ uncovered: uncovered.length, chunks: chunks.length, out: opts.out });
      return;
    }
    console.log(`未覆盖 ${uncovered.length} 个 skill → ${chunks.length} 个生成作业 → ${opts.out}`);
  });

  const genIngest = gen.command("ingest").description("回收生成结果，校验后写入 scenarios-auto");
  genIngest
    .option("--results <files>", "结果 JSONL（逗号分隔多个）", ".skillhub/gen-results.jsonl")
    .option("--scenarios <dir>", "已有 scenario 目录（算已覆盖，跳过）", "scenarios")
    .option("--auto-dir <dir>", "输出目录", "scenarios-auto")
    .option("--home <dir>", "覆盖用户主目录")
    .option("--json", "JSON 输出");
  genIngest.action((opts: { results: string; scenarios: string; autoDir: string; home?: string; json?: boolean }) => {
    const records = scanRecords(opts.home);
    const validNames = new Set(records.map((r) => r.name));
    const covered = new Set([...loadScenarios(opts.scenarios), ...loadScenarios(opts.autoDir)].map((s) => s.skill));
    const generated: Scenario[] = [];
    const invalid: Array<{ skill: string; reason: string }> = [];
    const skipped: string[] = [];
    for (const file of opts.results.split(",").map((f) => f.trim()).filter(Boolean)) {
      for (const line of fs.readFileSync(file, "utf8").split("\n")) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const obj = JSON.parse(trimmed) as { raw?: string };
          if (typeof obj.raw !== "string") continue;
          const outcome = parseGenResults(obj.raw, validNames);
          for (const scenario of outcome.generated) {
            if (covered.has(scenario.skill)) {
              skipped.push(scenario.skill);
              continue;
            }
            covered.add(scenario.skill);
            generated.push(scenario);
          }
          invalid.push(...outcome.invalid);
        } catch {
          invalid.push({ skill: "(行)", reason: `文件 ${file} 中有无法解析的行` });
        }
      }
    }
    const files = generated.map((s) => writeScenarioFile(opts.autoDir, s));
    if (opts.json) {
      printJson({ generated: generated.length, skipped: skipped.length, invalid, dir: opts.autoDir });
      return;
    }
    console.log(`生成 ${generated.length} 个 scenario → ${opts.autoDir}`);
    if (skipped.length > 0) console.log(`跳过（已有 scenario）：${skipped.join(", ")}`);
    if (invalid.length > 0) {
      console.log(`无效 ${invalid.length} 条：`);
      for (const item of invalid.slice(0, 10)) console.log(`  ✗ ${item.skill}：${item.reason}`);
    }
  });

  const exportCmd = program.command("export").description("导出公开质量榜数据 JSON（skill 最新分数 + 执行级成绩）");
  exportCmd
    .option("--out <file>", "输出 JSON 路径", "docs/leaderboard/data.json")
    .option("--exec-runs <file>", "执行级 run 汇总文件", ".skillhub/exec-runs.json")
    .option("--db <file>", "评测库路径", defaultDbPath());
  exportCmd.action((opts: { out: string; execRuns: string; db: string }) => {
    const db = openDb(opts.db);
    let execRuns: ExecRunRow[] = [];
    if (fs.existsSync(opts.execRuns)) {
      try {
        execRuns = JSON.parse(fs.readFileSync(opts.execRuns, "utf8")) as ExecRunRow[];
      } catch {
        execRuns = [];
      }
    }
    const data = collectLeaderboard(db, execRuns, new Date().toISOString());
    fs.mkdirSync(path.dirname(opts.out), { recursive: true });
    fs.writeFileSync(opts.out, JSON.stringify(data, null, 2) + "\n", "utf8");
    console.log(`质量榜数据已导出：${opts.out}（${data.skills.length} 个 skill，${data.runs.length} 个 run）`);
  });

  await program.parseAsync(argv, { from: "user" });
}

function isDirectRun(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return import.meta.url === pathToFileURL(entry).href;
  } catch {
    return false;
  }
}

if (isDirectRun()) {
  main(process.argv.slice(2)).catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  });
}
