#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { defaultRoots, findConflicts, parseSkillFile, recommendSkills, scanAll } from "@skillhub/core";
import fs from "node:fs";
import { pathToFileURL } from "node:url";

const VERSION = "0.1.0";

function getRecords() {
  // SKILLHUB_HOME 可指向自定义主目录（CI 用夹具库、多库用户可切换），默认本机
  const home = process.env.SKILLHUB_HOME || undefined;
  return scanAll(defaultRoots(home)).skills;
}

export function createServer(): McpServer {
  const server = new McpServer({ name: "skill-hub", version: VERSION });

  server.registerTool(
    "recommend_skills",
    {
      title: "推荐 skill",
      description:
        "按任务描述在本机 skill 库里推荐最合适的 skill。返回带匹配分、命中原因和质量警告的排序列表。" +
        "在为用户任务挑工具、或怀疑自己记忆中的 skill 列表过时的时候使用。",
      inputSchema: {
        task: z.string().describe("用户的任务描述，保留原话里的领域关键词，中英文皆可"),
        limit: z.number().int().min(1).max(20).optional().describe("返回条数，默认 5"),
      },
    },
    async ({ task, limit }) => {
      const recs = recommendSkills(getRecords(), task, limit ?? 5);
      return { content: [{ type: "text", text: JSON.stringify(recs, null, 2) }] };
    },
  );

  server.registerTool(
    "get_skill",
    {
      title: "查看 skill 详情",
      description:
        "返回指定 skill 的完整信息：frontmatter、正文 markdown、质量警告、跨目录出现情况。同名多目录时全部返回。",
      inputSchema: {
        name: z.string().describe("skill 的 frontmatter 名"),
      },
    },
    async ({ name }) => {
      const hits = getRecords().filter((r) => r.name === name);
      if (hits.length === 0) {
        return { content: [{ type: "text", text: `找不到名为 ${name} 的 skill` }], isError: true };
      }
      const details = hits.map((h) => ({
        id: h.id,
        name: h.name,
        source: h.source,
        version: h.version,
        description: h.description,
        hash: h.hash,
        files: h.files,
        warnings: h.quality.warnings,
        references: h.references,
        mentions: h.mentions,
        body: parseSkillFile(h.skillPath).body,
      }));
      return { content: [{ type: "text", text: JSON.stringify(details, null, 2) }] };
    },
  );

  server.registerTool(
    "library_stats",
    {
      title: "skill 库统计",
      description: "返回本机 skill 库的总览：各来源数量、去重名数、同名冲突组、内容漂移组、质量警告数。",
      inputSchema: {},
    },
    async () => {
      const records = getRecords();
      const conflicts = findConflicts(records);
      const diverged = conflicts.filter((g) => !g.identical);
      const stats = {
        total: records.length,
        uniqueNames: new Set(records.map((r) => r.name)).size,
        bySource: Object.fromEntries(
          [...new Set(records.map((r) => r.source))].map((s) => [s, records.filter((r) => r.source === s).length]),
        ),
        duplicateNameGroups: conflicts.length,
        divergedGroups: diverged.map((g) => g.name),
        totalWarnings: records.reduce((n, r) => n + r.quality.warnings.length, 0),
      };
      return { content: [{ type: "text", text: JSON.stringify(stats, null, 2) }] };
    },
  );

  return server;
}

export async function main(): Promise<void> {
  const server = createServer();
  await server.connect(new StdioServerTransport());
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
  void main();
}
