import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { getRunReport, insertRun, latestRun, listRuns, openDb, repeatStats, skillHistory } from "./db.js";
import type { RunReport } from "./types.js";

const report: RunReport = {
  startedAt: "2026-01-01T00:00:00Z",
  backend: "zcode",
  model: "glm-5.3-flash",
  results: [
    {
      skill: "demo",
      skillPath: "/skills/demo/SKILL.md",
      source: "agents",
      triggerScore: 80,
      triggerCorrect: 4,
      triggerTotal: 5,
      falsePositives: 1,
      clarityScore: 75,
      consistency: 4,
      actionability: 4,
      boundedness: 3,
      issues: ["x"],
      staticScore: 90,
      warningCount: 1,
      overall: 82,
      errors: 0,
    },
  ],
  avgTrigger: 80,
  avgClarity: 75,
  avgStatic: 90,
  avgOverall: 82,
};

describe("db roundtrip", () => {
  it("写入后 list/latest/get 一致", () => {
    const db = openDb(path.join(mkdtempSync(path.join(tmpdir(), "skillhub-db-")), "eval.db"));
    expect(latestRun(db)).toBeNull();
    const runId = insertRun(db, report);
    expect(runId).toBe(1);

    const runs = listRuns(db);
    expect(runs).toHaveLength(1);
    expect(runs[0]?.backend).toBe("zcode");
    expect(runs[0]?.totalSkills).toBe(1);
    expect(runs[0]?.avgOverall).toBe(82);

    const latest = latestRun(db);
    expect(latest?.report.results[0]?.skill).toBe("demo");
    expect(latest?.report.results[0]?.falsePositives).toBe(1);

    expect(getRunReport(db, 99)).toBeNull();
    expect(getRunReport(db, runId)?.summary.id).toBe(1);
  });

  it("自动建父目录", () => {
    const base = mkdtempSync(path.join(tmpdir(), "skillhub-db2-"));
    const db = openDb(path.join(base, "nested", "dir", "eval.db"));
    expect(listRuns(db)).toEqual([]);
  });

  it("策略版本与快照指纹写入并可查询历史与重复统计", () => {
    const db = openDb(path.join(mkdtempSync(path.join(tmpdir(), "skillhub-db3-")), "eval.db"));
    const base: RunReport = {
      ...report,
      strategyVersion: 2,
      skillSnapshotHashes: { demo: "abc123" },
      results: report.results.map((r) => ({ ...r, skillHash: "abc123" })),
    };
    // 同指纹 abc123 三次（稳定性基线），随后内容变更到 def456
    insertRun(db, { ...base, startedAt: "2026-01-01T00:00:00Z" });
    insertRun(db, { ...base, startedAt: "2026-01-02T00:00:00Z", results: base.results.map((r) => ({ ...r, overall: 84 })) });
    insertRun(db, { ...base, startedAt: "2026-01-03T00:00:00Z", results: base.results.map((r) => ({ ...r, overall: 86 })) });
    insertRun(db, {
      ...base,
      startedAt: "2026-01-04T00:00:00Z",
      skillSnapshotHashes: { demo: "def456" },
      results: base.results.map((r) => ({ ...r, skillHash: "def456", overall: 95 })),
    });

    const history = skillHistory(db, "demo");
    expect(history.map((h) => h.overall)).toEqual([82, 84, 86, 95]);
    expect(history[0]?.snapshotHash).toBe("abc123");
    expect(history[0]?.strategyVersion).toBe(2);

    // 重复统计以最新指纹为基准：def456 只有 1 次
    const repeat = repeatStats(history);
    expect(repeat.runs).toBe(1);
    expect(repeat.mean).toBe(95);

    // abc123 组的历史稳定性可由截断的历史得出
    const abcRepeat = repeatStats(history.slice(0, 3));
    expect(abcRepeat.runs).toBe(3);
    expect(abcRepeat.mean).toBe(84);
    expect(abcRepeat.stdDev).toBe(1.63);
  });

  it("存量 v1 库（无 eval_meta、runs 无新列）自动迁移且历史保留", () => {
    const file = path.join(mkdtempSync(path.join(tmpdir(), "skillhub-db4-")), "eval.db");
    const { DatabaseSync } = require("node:sqlite") as { DatabaseSync: typeof import("node:sqlite").DatabaseSync };
    const db = new DatabaseSync(file);
    db.exec(`CREATE TABLE runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT, started_at TEXT NOT NULL, backend TEXT NOT NULL, model TEXT,
      total_skills INTEGER NOT NULL, avg_trigger REAL, avg_clarity REAL, avg_static REAL NOT NULL, avg_overall REAL,
      raw_json TEXT NOT NULL)`);
    db.prepare(`INSERT INTO runs (started_at, backend, model, total_skills, avg_trigger, avg_clarity, avg_static, avg_overall, raw_json)
      VALUES ('2026-01-01T00:00:00Z', 'zcode', 'm', 1, 100, 80, 90, 82, ?)`).run(JSON.stringify(report));
    db.close();

    const reopened = openDb(file);
    expect(listRuns(reopened)).toHaveLength(1); // 迁移后历史保留
    const columns = (reopened.prepare("PRAGMA table_info(runs)").all() as Array<{ name?: string }>).map((c) => c.name);
    expect(columns).toContain("strategy_version");
    expect(columns).toContain("snapshot_hashes_json");
  });
});
