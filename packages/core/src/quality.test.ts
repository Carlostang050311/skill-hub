import { describe, expect, it } from "vitest";
import { computeQuality } from "./quality.js";
import { makeTempDir, writeSkill } from "./test-utils.js";

const longDescription = "很".repeat(260);

describe("computeQuality", () => {
  it("正常 skill 无警告", () => {
    const dir = makeTempDir();
    const skillDir = writeSkill(dir, "demo", "---\nname: demo\ndescription: 短描述\n---\n" + "正文".repeat(80), {
      "scripts/run.py": "print()",
    });
    const q = computeQuality({
      frontmatter: { name: "demo", description: "短描述" },
      body: "正文".repeat(80),
      dirName: "demo",
      files: ["scripts/run.py"],
      skillDir,
    });
    expect(q.warnings).toEqual([]);
    expect(q.missingResourceRefs).toEqual([]);
    expect(q.resourceFileCount).toBe(1);
  });

  it("超长 description 触发截断风险", () => {
    const q = computeQuality({
      frontmatter: { name: "demo", description: longDescription },
      body: "x".repeat(200),
      dirName: "demo",
      files: [],
      skillDir: makeTempDir(),
    });
    expect(q.descriptionTruncatedRisk).toBe(true);
    expect(q.warnings.some((w) => w.includes("截断"))).toBe(true);
  });

  it("缺 name、name 与目录不一致、格式不规范分别告警", () => {
    const base = { frontmatter: {}, body: "x".repeat(200), files: [], skillDir: makeTempDir() };
    const missing = computeQuality({ ...base, dirName: "demo" });
    expect(missing.hasName).toBe(false);
    expect(missing.warnings.some((w) => w.includes("name"))).toBe(true);

    const mismatch = computeQuality({
      ...base,
      frontmatter: { name: "other-name", description: "d" },
      dirName: "demo",
    });
    expect(mismatch.nameMatchesDir).toBe(false);
    expect(mismatch.warnings.some((w) => w.includes("不一致"))).toBe(true);

    const badFormat = computeQuality({
      ...base,
      frontmatter: { name: "Bad Name!", description: "d" },
      dirName: "demo",
    });
    expect(badFormat.nameFormatOk).toBe(false);
  });

  it("正文过薄告警", () => {
    const q = computeQuality({
      frontmatter: { name: "demo", description: "d" },
      body: "太短",
      dirName: "demo",
      files: [],
      skillDir: makeTempDir(),
    });
    expect(q.bodyTooThin).toBe(true);
  });

  it("引用不存在的资源告警，存在的资源不告警", () => {
    const dir = makeTempDir();
    const skillDir = writeSkill(dir, "demo", "---\nname: demo\n---\n占位", { "exists.py": "ok" });
    const body = "见 [脚本](./exists.py) 与 [缺失](./missing.py) 与 [外链](https://example.com/a.py)";
    const q = computeQuality({
      frontmatter: { name: "demo", description: "d" },
      body,
      dirName: "demo",
      files: ["exists.py"],
      skillDir,
    });
    expect(q.missingResourceRefs).toEqual(["./missing.py"]);
    expect(q.warnings.some((w) => w.includes("missing.py"))).toBe(true);
    expect(q.warnings.some((w) => w.includes("exists.py"))).toBe(false);
  });
});
