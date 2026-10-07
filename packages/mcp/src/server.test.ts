import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const SERVER_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../dist/server.js");

let child: ChildProcessWithoutNullStreams | null = null;

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

describe.skipIf(!fs.existsSync(SERVER_PATH))("MCP server（stdio JSON-RPC）", () => {
  afterEach(() => {
    child?.kill();
    child = null;
  });

  it("initialize → tools/list → tools/call 全链路", async () => {
    expect(fs.existsSync(SERVER_PATH)).toBe(true);
    child = spawn("node", [SERVER_PATH], { stdio: ["pipe", "pipe", "pipe"] });

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
  }, 60_000);
});
