import { describe, expect, it } from "vitest";
import { checkMutationOrigin } from "./mutations.js";

describe("本地写入来源", () => {
  it("允许实际 Host 与 Next 内部 URL 不同，但拒绝其他网站和端口", () => {
    const request = (origin: string) => new Request("http://localhost:3458/api/install", { headers: { host: "127.0.0.1:3458", origin } });
    expect(() => checkMutationOrigin(request("http://127.0.0.1:3458"))).not.toThrow();
    expect(() => checkMutationOrigin(request("https://example.org"))).toThrow(/当前本地页面/);
    expect(() => checkMutationOrigin(request("http://127.0.0.1:9999"))).toThrow(/当前本地页面/);
    expect(() => checkMutationOrigin(new Request("http://localhost:3458/api/install"))).not.toThrow();
  });
  it("拒绝伪造匹配的远程 Host/Origin 与无 Origin 的远程 Host", () => {
    const remote = new Request("http://localhost:3458/api/repair", { headers: { host: "attacker.example:3458", origin: "http://attacker.example:3458" } });
    expect(() => checkMutationOrigin(remote)).toThrow(/当前本地页面/);
    expect(() => checkMutationOrigin(new Request("http://192.168.1.2:3458/api/repair"))).toThrow(/当前本地页面/);
    expect(() => checkMutationOrigin(new Request("http://localhost:3458/api/repair", { headers: { host: "user@localhost:3458" } }))).toThrow(/当前本地页面/);
    expect(() => checkMutationOrigin(new Request("http://[::1]:3458/api/repair", { headers: { origin: "http://[::1]:3458" } }))).not.toThrow();
  });
});
