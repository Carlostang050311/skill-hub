import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makeTempDir, writeSkill } from "../../core/src/test-utils.js";

const SERVER_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../dist/server.js");

let child: ChildProcessWithoutNullStreams | null = null;
let fixtureHome: string;

function rpc(child2: ChildProcessWithoutNullStreams, message: Record<string, unknown>): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`RPC 超时：${JSON.stringify(message).slice(0, 80)}`)), 30_000);
    const onData = (chunk: Buffer): void => {
      for (const line of chunk.toString().split("\n")) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const parsed = JSON.parse(trimmed) as Record<string, unknown>;
          if (parsed.id != null) {
            clearTimeout(timer);
            child2.stdout.off("data", onData);
            resolve(parsed);
            return;
          }
        } catch {
          // 忽略非 JSON 行
        }
      }
    };
    child2.stdout.on("data", onData);
    child2.stdin.write(JSON.stringify(message) + "\n");
  });
}

beforeEach(() => {
  // 封闭夹具库：CI 上没有本机 skill 库，测 recommend 必须自带数据
  fixtureHome = makeTempDir("skillhub-mcp-");
  writeSkill(
    fixtureHome,
    ".agents/skills/youtube-clipper",
    "---\nname: youtube-clipper\ndescription: YouTube 视频智能剪辑工具。下载视频和字幕，剪辑、翻译字幕为中英双语、烧录字幕到视频。\n---\n" + "Y".repeat(150),
  );
  writeSkill(
    fixtureHome,
    ".agents/skills/humanizer-zh",
    "---\nname: humanizer-zh\ndescription: 编辑中文文章中的空话与模板化表达，让文字更自然。\n---\n" + "H".repeat(150),
  );
});

afterEach(() => {
  child?.kill();
  child = null;
  fs.rmSync(fixtureHome, { recursive: true, force: true });
});

describe.skipIf(!fs.existsSync(SERVER_PATH))("MCP server（stdio JSON-RPC）", () => {
  it("initialize → tools/list → tools/call 全链路（夹具库）", async () => {
    expect(fs.existsSync(SERVER_PATH)).toBe(true);
    child = spawn("node", [SERVER_PATH], {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, SKILLHUB_HOME: fixtureHome },
    });

    const init = await rpc(child, {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "vitest", version: "0.0.1" },
      },
    });
    const serverInfo = (init.result as { serverInfo?: { name?: string } })?.serverInfo;
    expect(serverInfo?.name).toBe("skill-hub");

    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");

    const tools = await rpc(child, { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
    const toolNames = ((tools.result as { tools?: Array<{ name: string }> })?.tools ?? []).map((t) => t.name);
    expect(toolNames).toEqual(["recommend_skills", "get_skill", "library_stats"]);

    const call = await rpc(child, {
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "recommend_skills", arguments: { task: "剪一段 youtube 视频出短视频", limit: 3 } },
    });
    const text = (call.result as { content?: Array<{ text?: string }> })?.content?.[0]?.text ?? "";
    const recs = JSON.parse(text) as Array<{ name: string; score: number }>;
    expect(recs.length).toBeGreaterThan(0);
    expect(recs[0]?.name).toBe("youtube-clipper");

    const stats = await rpc(child, {
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: { name: "library_stats", arguments: {} },
    });
    const statsText = (stats.result as { content?: Array<{ text?: string }> })?.content?.[0]?.text ?? "";
    const statsData = JSON.parse(statsText) as { total: number };
    expect(statsData.total).toBe(2);
  }, 60_000);
});
