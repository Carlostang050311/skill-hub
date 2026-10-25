import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { defaultRoots, type ScanRoot } from "@skillhub/core";
import { InventoryStore, readInventory, rootSignature } from "./inventory.js";

const tempDirs: string[] = [];

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "skillhub-inventory-"));
  tempDirs.push(dir);
  return dir;
}

function writeSkill(home: string, relative: string, body: string, name = "demo"): void {
  const dir = path.join(home, relative);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "SKILL.md"), `---\nname: ${name}\ndescription: 测试\n---\n${body}`, "utf8");
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("InventoryStore", () => {
  it("保存扫描快照并可按当前或 scanRunId 完整恢复", () => {
    const home = tempDir();
    writeSkill(home, ".agents/skills/demo", "说明");
    const roots = defaultRoots(home);
    const result = readInventory(roots, path.join(home, "inventory.db"));
    expect(result.scanRunId).toMatch(/^[a-f0-9-]{36}$/);
    expect(result.result.skills).toHaveLength(1);
    expect(result.result.skills[0]?.quality).toBeDefined();

    const store = new InventoryStore(path.join(home, "inventory.db"));
    expect(store.current()?.scanRunId).toBe(result.scanRunId);
    expect(store.get(result.scanRunId)?.result.skills[0]?.name).toBe("demo");
  });

  it("同一 roots 在非 refresh 模式复用快照，refresh 后保留历史运行", () => {
    const home = tempDir();
    writeSkill(home, ".agents/skills/demo", "第一版");
    const roots = defaultRoots(home);
    const file = path.join(home, "inventory.db");
    const first = readInventory(roots, file);
    fs.writeFileSync(path.join(home, ".agents/skills/demo", "SKILL.md"), "---\nname: demo\ndescription: 测试\n---\n第二版", "utf8");
    const reused = readInventory(roots, file, { refresh: false });
    expect(reused.scanRunId).toBe(first.scanRunId);
    expect(reused.result.skills[0]?.bodyChars).toBe(first.result.skills[0]?.bodyChars);
    const refreshed = readInventory(roots, file, { refresh: true });
    expect(refreshed.scanRunId).not.toBe(first.scanRunId);
    expect(new InventoryStore(file).get(first.scanRunId)).not.toBeNull();
    expect(refreshed.result.skills[0]?.hash).not.toBe(first.result.skills[0]?.hash);
  });

  it("不同 roots 不会误用另一份当前快照", () => {
    const home = tempDir();
    const first: ScanRoot = { source: "one", path: path.join(home, "one"), sourceKind: "custom", maxDepth: 3 };
    const second: ScanRoot = { source: "two", path: path.join(home, "two"), sourceKind: "custom", maxDepth: 3 };
    fs.mkdirSync(first.path, { recursive: true });
    fs.mkdirSync(second.path, { recursive: true });
    writeSkill(home, "one/demo", "一");
    writeSkill(home, "two/other", "二", "other");
    const file = path.join(home, "inventory.db");
    const a = readInventory([first], file);
    const b = readInventory([second], file, { refresh: false });
    expect(rootSignature([first])).not.toBe(rootSignature([second]));
    expect(a.result.skills[0]?.name).toBe("demo");
    expect(b.result.skills[0]?.name).toBe("other");
    expect(b.scanRunId).not.toBe(a.scanRunId);
  });
});
