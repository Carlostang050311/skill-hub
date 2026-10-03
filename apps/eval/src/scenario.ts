import fs from "node:fs";
import path from "node:path";
import { parse } from "yaml";
import type { Scenario } from "./types.js";

/** 解析单个 scenario YAML；字段宽松读取，关键项缺失即抛错 */
export function parseScenarioYaml(text: string, file: string): Scenario {
  const data: unknown = parse(text);
  if (!data || typeof data !== "object") throw new Error(`${file}: 内容不是 YAML 映射`);
  const map = data as Record<string, unknown>;
  const skill = typeof map.skill === "string" ? map.skill.trim() : "";
  if (!skill) throw new Error(`${file}: 缺少 skill 字段`);
  const toList = (value: unknown): string[] => {
    if (!Array.isArray(value)) return [];
    return value
      .filter((x): x is string => typeof x === "string" && x.trim().length > 0)
      .map((x) => x.trim());
  };
  const shouldTrigger = toList(map.should_trigger);
  const shouldNotTrigger = toList(map.should_not_trigger);
  if (shouldTrigger.length === 0) throw new Error(`${file}: should_trigger 至少要有一条`);
  if (shouldNotTrigger.length === 0) throw new Error(`${file}: should_not_trigger 至少要有一条`);
  return {
    skill,
    shouldTrigger,
    shouldNotTrigger,
    notes: typeof map.notes === "string" ? map.notes : undefined,
  };
}

/** 加载目录下全部 scenario YAML，按文件名排序保证稳定 */
export function loadScenarios(dir: string): Scenario[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"))
    .sort()
    .map((f) => parseScenarioYaml(fs.readFileSync(path.join(dir, f), "utf8"), f));
}
