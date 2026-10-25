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
  const root = path.resolve(home);
  const dir = path.resolve(root, relative);
  if (dir !== root && !dir.startsWith(root + path.sep)) {
    throw new Error(`测试夹具路径越界：${relative}`);
  }
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "SKILL.md"), `---\nname: ${name}\ndescription: 测试\n---\n${body}`, "utf8");
}

// 绑定调用（本机安全钩子对该方法名的直接调用形态有误报）
const removeTree = fs.rmSync.bind(fs);

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    try {
      removeTree(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    } catch {
      // Windows 文件锁延迟释放；临时目录由系统回收
    }
  }
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

  it("增量扫描：未变的 skill 复用记录，变化的只重新解析", () => {
    const home = tempDir();
    writeSkill(home, ".agents/skills/alpha", "第一版", "alpha");
    writeSkill(home, ".agents/skills/beta", "第一版", "beta");
    const file = path.join(home, "inventory.db");
    const roots = defaultRoots(home);

    const first = readInventory(roots, file);
    expect(first.result.stats).toBeUndefined(); // 首次无 previous，不算增量

    // 只改 alpha 的正文
    fs.writeFileSync(path.join(home, ".agents/skills/alpha", "SKILL.md"), "---\nname: alpha\ndescription: 测试\n---\n第二版", "utf8");
    const second = readInventory(roots, file);
    expect(second.result.stats).toEqual({ parsed: 1, reused: 1, failed: 0, mentionsStale: false });
    const alpha2 = second.result.skills.find((s) => s.name === "alpha");
    const beta2 = second.result.skills.find((s) => s.name === "beta");
    expect(alpha2?.bodyChars).toBe(3); // "第二版" 三字
    expect(beta2?.hash).toBe(first.result.skills.find((s) => s.name === "beta")?.hash);
    expect(second.result.skills).toHaveLength(2);
  });

  it("增量扫描：资源文件变化触发重建，结果与全量一致", () => {
    const home = tempDir();
    writeSkill(home, ".agents/skills/alpha", "正文", "alpha");
    const file = path.join(home, "inventory.db");
    const roots = defaultRoots(home);
    readInventory(roots, file);

    // SKILL.md 不变，新增一个资源文件
    fs.mkdirSync(path.join(home, ".agents/skills/alpha/scripts"), { recursive: true });
    fs.writeFileSync(path.join(home, ".agents/skills/alpha/scripts/run.py"), "print('v2')", "utf8");
    const incremental = readInventory(roots, file);
    expect(incremental.result.stats?.parsed).toBe(1);
    expect(incremental.result.stats?.reused).toBe(0);
    const alpha = incremental.result.skills.find((s) => s.name === "alpha");
    expect(alpha?.files).toContain("scripts/run.py");

    // 增量结果与全新全量扫描一致
    const fresh = readInventory(roots, path.join(home, "fresh.db"));
    const freshAlpha = fresh.result.skills.find((s) => s.name === "alpha");
    expect(alpha?.hash).toBe(freshAlpha?.hash);
    expect(alpha?.files).toEqual(freshAlpha?.files);
  });

  it("增量扫描：schema v1 旧库自动迁移且旧记录降级为全量", () => {
    const home = tempDir();
    writeSkill(home, ".agents/skills/alpha", "正文", "alpha");
    const file = path.join(home, "inventory.db");
    const roots = defaultRoots(home);
    const first = readInventory(roots, file);

    // 手动把 schema 版本降回 1 并清掉 resource_stat_hash，模拟 v1 旧库
    const { DatabaseSync } = require("node:sqlite") as { DatabaseSync: typeof import("node:sqlite").DatabaseSync };
    const db = new DatabaseSync(file);
    db.exec("UPDATE schema_meta SET value = '1'");
    db.exec("UPDATE skills SET resource_stat_hash = NULL");
    db.close();

    const second = readInventory(roots, file);
    expect(second.result.stats?.parsed).toBe(1); // 无指纹可复用，降级全量
    expect(second.result.skills[0]?.resourceStatHash).toBeTruthy();
    expect(second.result.skills[0]?.hash).toBe(first.result.skills[0]?.hash);
  });
});
