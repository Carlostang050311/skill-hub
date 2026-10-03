import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { getRunReport, insertRun, latestRun, listRuns, openDb } from "./db.js";
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
});
