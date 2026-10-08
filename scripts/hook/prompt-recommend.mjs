#!/usr/bin/env node
// skill-hub 主动推荐 hook：UserPromptSubmit 时轻量查库，命中高分 skill 就注入上下文。
// 输入：stdin 的 hook JSON（含 prompt/agentName/cwd 等字段）；输出：hookSpecificOutput JSON。
// 任何内部错误都静默退出 0（空输出合法），绝不阻塞会话。
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const REPO_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const CLI = path.join(REPO_DIR, "packages", "cli", "dist", "cli.js");
const STATE_FILE = path.join(process.env.SKILLHUB_HOME ?? os.homedir(), ".skillhub", "hook-state.json");
const MIN_PROMPT_CHARS = 12;
const MAX_PROMPT_CHARS = 600;
const MIN_SCORE = 25;
const PREFETCH_SCORE = 40;
const BODY_SNIPPET_CHARS = 600;
const DEDUPE_WINDOW_MS = 30 * 60 * 1000;
export function parseHookInput(raw) {
    const text = raw == null ? "" : String(raw);
    let parsed = null;
    try {
        const obj = JSON.parse(text);
        if (obj && typeof obj === "object")
            parsed = obj;
    }
    catch {
        parsed = null;
    }
    if (parsed) {
        let prompt = "";
        for (const key of ["prompt", "user_prompt", "userPrompt", "message", "text", "input"]) {
            const v = parsed[key];
            if (typeof v === "string" && v.trim()) {
                prompt = v;
                break;
            }
        }
        // JSON 里没有已知 prompt 字段：宁可不推荐，也不能拿原始 JSON 自匹配（键名 "prompt" 含 "pr"）
        const str = (k) => (typeof parsed?.[k] === "string" ? parsed[k] : "");
        return { prompt: prompt.trim(), agentName: str("agentName"), cwd: str("cwd"), mode: str("mode") };
    }
    return { prompt: text.trim(), agentName: "", cwd: "", mode: "" };
}
/** 子代理的 prompt 是任务指令（注入推荐纯属噪音）；skill-hub 自家仓库不推销自己 */
export function shouldSkip(input, repoDir) {
    if (input.agentName === "zcode-workflow")
        return true;
    if (input.cwd) {
        const norm = (p) => path.resolve(p).toLowerCase();
        const cwd = norm(input.cwd);
        const repo = norm(repoDir);
        if (cwd === repo || cwd.startsWith(repo + path.sep))
            return true;
    }
    return false;
}
export function buildContext(name, score, body) {
    if (body && body.trim()) {
        return (`skill-hub 提示：本机 skill 库里有现成技能「${name}」（匹配分 ${score}），指导书要点如下：\n` +
            body.slice(0, BODY_SNIPPET_CHARS) +
            `\n（完整指导书：skillhub show ${name}）`);
    }
    return `skill-hub 提示：本机 skill 库里有现成技能「${name}」（匹配分 ${score}）。动手前建议先用 skillhub show ${name} 查看它的用法，或直接按其指导执行，避免重复造轮子。`;
}
function readStdinSync() {
    try {
        return fs.readFileSync(0, "utf8");
    }
    catch {
        return "";
    }
}
function dedupeShouldSkip(name) {
    try {
        const state = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
        const last = state[name];
        if (typeof last === "number" && Date.now() - last < DEDUPE_WINDOW_MS)
            return true;
    }
    catch {
        // 无状态文件视为首次
    }
    return false;
}
function recordShown(name) {
    try {
        let state = {};
        try {
            state = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
        }
        catch {
            state = {};
        }
        state[name] = Date.now();
        // 上限 200 条，最旧的先淘汰，防无限增长
        const entries = Object.entries(state).sort((a, b) => a[1] - b[1]);
        while (entries.length > 200)
            entries.shift();
        fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
        fs.writeFileSync(STATE_FILE, JSON.stringify(Object.fromEntries(entries), null, 2) + "\n", "utf8");
    }
    catch {
        // 状态记录失败不影响主流程
    }
}
function main() {
    const raw = readStdinSync();
    // 输入快照：便于对照 ZCode 实际传参形状，持续改进字段提取（每次覆盖，上限 2KB）
    try {
        fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
        fs.writeFileSync(path.join(path.dirname(STATE_FILE), "hook-last-input.txt"), raw.slice(0, 2048), "utf8");
    }
    catch {
        // 快照失败不影响主流程
    }
    const input = parseHookInput(raw);
    if (shouldSkip(input, REPO_DIR))
        return;
    if (input.prompt.length < MIN_PROMPT_CHARS || input.prompt.startsWith("/"))
        return;
    const probe = input.prompt.slice(0, MAX_PROMPT_CHARS);
    const run = spawnNpxCli(["recommend", probe, "--limit", "2", "--json", "--with-body"]);
    if (run.status !== 0 || !run.stdout.trim())
        return;
    let recs;
    try {
        recs = JSON.parse(run.stdout);
    }
    catch {
        return;
    }
    if (!Array.isArray(recs) || recs.length === 0)
        return;
    const top = recs[0];
    if (!top || typeof top.name !== "string" || typeof top.score !== "number" || top.score < MIN_SCORE)
        return;
    if (dedupeShouldSkip(top.name))
        return;
    recordShown(top.name);
    const second = recs[1];
    const hasSecond = second != null &&
        typeof second.name === "string" &&
        typeof second.score === "number" &&
        second.score >= PREFETCH_SCORE &&
        second.score >= top.score * 0.75;
    let context;
    const topBody = typeof top.body === "string" ? top.body : "";
    if (top.score >= PREFETCH_SCORE) {
        context = buildContext(top.name, top.score, topBody);
    }
    else {
        context = buildContext(top.name, top.score);
    }
    if (hasSecond && second) {
        context = `另有候选「${second.name}」（匹配分 ${second.score}）——多步任务可搭配。\n` + context;
    }
    process.stdout.write(JSON.stringify({
        hookSpecificOutput: {
            hookEventName: "UserPromptSubmit",
            additionalContext: context,
        },
    }));
}
/** 跨平台调本仓库 CLI：字面量命令 + 参数向量（node cli.js），不经过 shell */
function spawnNpxCli(args) {
    try {
        const stdout = execFileSync("node", [CLI, ...args], {
            encoding: "utf8",
            timeout: 8000,
            stdio: ["ignore", "pipe", "pipe"],
        });
        return { status: 0, stdout, stderr: "" };
    }
    catch (err) {
        const e = err;
        return { status: e.status ?? 1, stdout: e.stdout ?? "", stderr: e.stderr ?? e.message ?? String(err) };
    }
}
// 仅直接执行时运行（被 import 时不读 stdin，避免测试进程阻塞）
function isDirectRun() {
    const entry = process.argv[1];
    if (!entry)
        return false;
    try {
        return import.meta.url === pathToFileURL(entry).href;
    }
    catch {
        return false;
    }
}
try {
    if (isDirectRun())
        main();
}
catch {
    // 静默失败：hook 不应阻塞会话
}
export function extractPrompt(raw) { return parseHookInput(raw).prompt; }
