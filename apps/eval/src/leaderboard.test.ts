import { describe, expect, it } from "vitest";
import { buildLeaderboardData, type ExecRunRow } from "./leaderboard.js";
import type { RunSummaryRow } from "./db.js";

function run(id: number, totalSkills: number, avgOverall: number | null): RunSummaryRow {
  return {
    id,
    startedAt: "2026-10-0" + id + "T00:00:00Z",
    backend: "zcode",
    model: "glm-5.3-flash",
    totalSkills,
    avgTrigger: 100,
    avgClarity: 80,
    avgStatic: 90,
    avgOverall,
  };
}

const resultsFor = (runId: number) => {
  if (runId === 1) {
    return [
      { skill: "a", overall: 78, triggerScore: 100, clarityScore: 67, staticScore: 60 },
      { skill: "b", overall: 90, triggerScore: 100, clarityScore: 87, staticScore: 100 },
    ];
  }
  if (runId === 4) {
    return [{ skill: "a", overall: 86, triggerScore: 100, clarityScore: 73, staticScore: 80 }];
  }
  return [];
};

const execRuns: ExecRunRow[] = [
  {
    runAt: "2026-10-07T00:00:00Z",
    results: [{ skill: "b", score: 100, rubricPassed: 4, rubricTotal: 4 }],
  },
];

describe("buildLeaderboardData", () => {
  it("每个 skill 取最新 run 的分数，exec 挂到已有 skill 上", () => {
    const data = buildLeaderboardData([run(1, 2, 84), run(4, 1, 86)], resultsFor, execRuns, "2026-10-07T01:00:00Z");
    expect(data.skills.map((s) => s.name)).toEqual(["b", "a"]);
    const a = data.skills.find((s) => s.name === "a");
    expect(a?.overall).toBe(86);
    expect(a?.lastRunId).toBe(4);
    expect(a?.exec).toBeNull();
    const b = data.skills.find((s) => s.name === "b");
    expect(b?.overall).toBe(90);
    expect(b?.exec?.score).toBe(100);
  });

  it("只有执行级成绩的 skill 也会上榜", () => {
    const execOnly: ExecRunRow[] = [
      { runAt: "2026-10-07T00:00:00Z", results: [{ skill: "solo", score: 75, rubricPassed: 3, rubricTotal: 4 }] },
    ];
    const data = buildLeaderboardData([run(1, 2, 84)], resultsFor, execOnly, "t");
    const solo = data.skills.find((s) => s.name === "solo");
    expect(solo?.exec?.score).toBe(75);
    expect(solo?.overall).toBeNull();
  });

  it("runs 趋势按 id 正序输出", () => {
    const data = buildLeaderboardData([run(4, 1, 86), run(1, 2, 84)], resultsFor, [], "t");
    expect(data.runs.map((r) => r.id)).toEqual([1, 4]);
    expect(data.generatedAt).toBe("t");
  });
});
