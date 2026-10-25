import { describe, expect, it } from "vitest";
import { aggregateRecommendEvents, parseRecommendEvents } from "./events.js";

const LINES = [
  '{"ts":"2026-10-25T01:00:00Z","skill":"tdd","score":47,"taskHash":"aaaa1111","project":"alpha"}',
  '{"ts":"2026-10-25T02:00:00Z","skill":"tdd","score":45,"taskHash":"bbbb2222","project":"alpha"}',
  '{"ts":"2026-10-26T03:00:00Z","skill":"teach","score":30,"taskHash":"cccc3333","project":"beta"}',
  "坏行",
  '{"id":"缺字段的行"}',
  "",
];

describe("parseRecommendEvents", () => {
  it("解析合法行、跳过坏行与缺字段行", () => {
    const events = parseRecommendEvents(LINES);
    expect(events).toHaveLength(3);
    expect(events[0]?.skill).toBe("tdd");
  });
});

describe("aggregateRecommendEvents", () => {
  it("聚合展示次数/去重任务/天数并按展示排序", () => {
    const events = parseRecommendEvents(LINES);
    const summary = aggregateRecommendEvents(events);
    expect(summary.totalEvents).toBe(3);
    expect(summary.distinctTasks).toBe(3);
    expect(summary.distinctSkills).toBe(2);
    expect(summary.days).toBe(2);
    expect(summary.skills[0]?.name).toBe("tdd");
    expect(summary.skills[0]?.shown).toBe(2);
    expect(summary.skills[0]?.avgScore).toBe(46);
    expect(summary.skills[1]?.avgScore).toBe(30);
  });

  it("空输入返回零值结构", () => {
    const summary = aggregateRecommendEvents([]);
    expect(summary.totalEvents).toBe(0);
    expect(summary.skills).toEqual([]);
  });
});
