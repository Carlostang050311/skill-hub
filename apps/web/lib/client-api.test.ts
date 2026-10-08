import { afterEach, describe, expect, it, vi } from "vitest";
import { apiJson } from "./client-api.js";

afterEach(() => vi.unstubAllGlobals());
describe("评测任务 API 状态", () => {
  it("成功请求中的失败任务能展示详情，HTTP 错误仍正常拒绝", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(Response.json({ status: "failed", error: "API HTTP 429", results: [] })).mockResolvedValueOnce(Response.json({ error: "未知副本" }, { status: 400 })));
    expect(await apiJson("/api/eval?id=task")).toEqual({ status: "failed", error: "API HTTP 429", results: [] });
    await expect(apiJson("/api/eval", {})).rejects.toThrow("未知副本");
  });
});
