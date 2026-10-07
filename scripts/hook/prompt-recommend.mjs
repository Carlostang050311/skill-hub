#!/usr/bin/env node
// skill-hub 主动推荐 hook：UserPromptSubmit 时轻量查库，命中高分 skill 就注入一行上下文。
// 输入：stdin 的 hook JSON（字段名按多种形状防御式解析）；输出：hookSpecificOutput JSON。
// 任何内部错误都静默退出 0（空输出合法），绝不阻塞会话。
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const CLI = path.join("F:", "Coding", "skill-hub", "packages", "cli", "dist", "cli.js");
const STATE_FILE = path.join(os.homedir(), ".skillhub", "hook-state.json");
const MIN_PROMPT_CHARS = 12;
const MAX_PROMPT_CHARS = 600;
const MIN_SCORE = 25;
const DEDUPE_WINDOW_MS = 30 * 60 * 1000;

export function extractPrompt(raw) {
  let text = raw == null ? "" : String(raw);
  let parsed = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = null;
  }
  if (parsed && typeof parsed === "object") {
    for (const key of ["prompt", "user_prompt", "userPrompt", "message", "text", "input"]) {
      const v = parsed[key];
      if (typeof v === "string" && v.trim()) {
        text = v;
        return text.trim();
      }
    }
    // JSON 里没有已知 prompt 字段：宁可不推荐，也不能拿原始 JSON 自匹配
    // （键名如 "prompt" 含 "pr"，会把无关 skill 顶上榜）
    return "";
  }
  return text.trim();
}

export function buildContext(name, score) {
  return `skill-hub 提示：本机 skill 库里有现成技能「${name}」（匹配分 ${score}）。动手前建议先用 skillhub show ${name} 查看它的用法，或直接按其指导执行，避免重复造轮子。`;
}

function readStdinSync() {
  try {
    return fs.readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

function dedupeShouldSkip(name) {
  try {
    const state = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
    const last = state[name];
    if (typeof last === "number" && Date.now() - last < DEDUPE_WINDOW_MS) return true;
  } catch {
    // 无状态文件视为首次
  }
  return false;
}

function recordShown(name) {
  try {
    let state = {};
    try {
      state = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
    } catch {
      state = {};
    }
    state[name] = Date.now();
    // 上限 200 条，最旧的先淘汰，防无限增长
    const entries = Object.entries(state).sort((a, b) => a[1] - b[1]);
    while (entries.length > 200) entries.shift();
    fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify(Object.fromEntries(entries), null, 2) + "\n", "utf8");
  } catch {
    // 状态记录失败不影响主流程
  }
}

function main() {
  const raw = readStdinSync();
  // 输入快照：便于对照 ZCode 实际传参形状，持续改进字段提取（每次覆盖，上限 2KB）
  try {
    fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
    fs.writeFileSync(path.join(path.dirname(STATE_FILE), "hook-last-input.txt"), raw.slice(0, 2048), "utf8");
  } catch {
    // 快照失败不影响主流程
  }
  const prompt = extractPrompt(raw);
  if (prompt.length < MIN_PROMPT_CHARS || prompt.startsWith("/")) return;
  const probe = prompt.slice(0, MAX_PROMPT_CHARS);

  const run = spawnSync("node", [CLI, "recommend", probe, "--limit", "2", "--json"], {
    encoding: "utf8",
    timeout: 8000,
  });
  if (run.status !== 0 || !run.stdout.trim()) return;
  let recs;
  try {
    recs = JSON.parse(run.stdout);
  } catch {
    return;
  }
  if (!Array.isArray(recs) || recs.length === 0) return;
  const top = recs[0];
  if (!top || typeof top.score !== "number" || top.score < MIN_SCORE) return;
  if (dedupeShouldSkip(top.name)) return;
  recordShown(top.name);

  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "UserPromptSubmit",
        additionalContext: buildContext(top.name, top.score),
      },
    }),
  );
}

// 仅直接执行时运行（被 import 时不读 stdin，避免测试进程阻塞）
function isDirectRun() {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return import.meta.url === pathToFileURL(entry).href;
  } catch {
    return false;
  }
}

try {
  if (isDirectRun()) main();
} catch {
  // 静默失败：hook 不应阻塞会话
}
