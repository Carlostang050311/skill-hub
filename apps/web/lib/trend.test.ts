import { describe, expect, it } from "vitest";
import type { RunSummaryRow } from "@skillhub/eval";
import { buildTrend, skillDeltas } from "./trend.js";

function summary(id: number, over: Partial<RunSummaryRow>): RunSummaryRow {
  return {
    id,
    startedAt: "2026-10-05T00:00:00Z",
    backend: "zcode",
    model: "glm-5.3-flash",
    totalSkills: 10,
    avgTrigger: 100,
    avgClarity: 80,
    avgStatic: 90,
    avgOverall: 88,
    ...over,
  };
}

describe("buildTrend", () => {
  it("倒序入库转为时间正序并取整", () => {
    const points = buildTrend([
      summary(3, { avgOverall: 92.6, avgClarity: null }),
      summary(2, { avgOverall: 90.8333 }),
      summary(1, { avgOverall: 88.4 }),
    ]);
    expect(points.map((p) => p.runId)).toEqual([1, 2, 3]);
    expect(points[0]?.overall).toBe(88);
    expect(points[1]?.overall).toBe(91);
    expect(points[2]?.clarity).toBeNull();
    expect(points[0]?.label).toBe("#1");
  });
});

describe("skillDeltas", () => {
  it("同名跨 run 首末对比，按绝对变化排序，0 变化不列", () => {
    const deltas = skillDeltas([
      { runId: 1, skill: "a", overall: 78 },
      { runId: 4, skill: "a", overall: 86 },
      { runId: 6, skill: "b", overall: 90 },
      { runId: 9, skill: "b", overall: 92 },
      { runId: 9, skill: "flat", overall: 95 },
      { runId: 6, skill: "flat", overall: 95 },
      { runId: 9, skill: "only-once", overall: 80 },
    ]);
    expect(deltas.map((d) => d.name)).toEqual(["a", "b"]);
    expect(deltas[0]?.delta).toBe(8);
    expect(deltas[0]?.first.runId).toBe(1);
    expect(deltas[0]?.latest.runId).toBe(4);
    expect(deltas[1]?.delta).toBe(2);
  });

  it("无重复 skill 时返回空", () => {
    expect(skillDeltas([{ runId: 1, skill: "x", overall: 80 }])).toEqual([]);
  });
});
