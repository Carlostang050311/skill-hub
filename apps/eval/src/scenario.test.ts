import { describe, expect, it } from "vitest";
import { parseScenarioYaml, loadScenarios } from "./scenario.js";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

describe("parseScenarioYaml", () => {
  it("解析合法 scenario", () => {
    const sc = parseScenarioYaml(
      "skill: aihot\nshould_trigger:\n  - 今天有什么 AI 新闻\n  - AI 日报\nshould_not_trigger:\n  - 写个快排\nnotes: 备注可选\n",
      "aihot.yaml",
    );
    expect(sc.skill).toBe("aihot");
    expect(sc.shouldTrigger).toHaveLength(2);
    expect(sc.shouldNotTrigger).toEqual(["写个快排"]);
    expect(sc.notes).toBe("备注可选");
  });

  it("缺 skill 抛错", () => {
    expect(() => parseScenarioYaml("should_trigger:\n  - x\nshould_not_trigger:\n  - y\n", "bad.yaml")).toThrow(/skill/);
  });

  it("should_trigger 为空抛错", () => {
    expect(() => parseScenarioYaml("skill: x\nshould_trigger: []\nshould_not_trigger:\n  - y\n", "bad.yaml")).toThrow(/should_trigger/);
  });

  it("should_not_trigger 为空抛错", () => {
    expect(() => parseScenarioYaml("skill: x\nshould_trigger:\n  - y\n", "bad.yaml")).toThrow(/should_not_trigger/);
  });
});

describe("loadScenarios", () => {
  it("按文件名排序加载目录下全部 YAML，目录缺失返回空", () => {
    const dir = path.join(mkdtempSync(path.join(tmpdir(), "skillhub-scen-")), "scen");
    mkdirSync(dir, { recursive: true });
    for (const name of ["b.yaml", "a.yaml"]) {
      writeFileSync(path.join(dir, name), `skill: s-${name}\nshould_trigger:\n  - t\nshould_not_trigger:\n  - f\n`);
    }
    writeFileSync(path.join(dir, "readme.md"), "不是 scenario");
    const loaded = loadScenarios(dir);
    expect(loaded.map((s) => s.skill)).toEqual(["s-a.yaml", "s-b.yaml"]);
    expect(loadScenarios(path.join(dir, "nope"))).toEqual([]);
  });
});
