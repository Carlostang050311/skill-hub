import { describe, expect, it } from "vitest";
import { reportStatus } from "./report-status";
import type { SkillEvalReport } from "@skillhub/eval";
import type { SkillRecord } from "@skillhub/core";

describe("报告版本状态", () => {
  it("区分历史未绑定、当前完整、版本变化和未完成", () => {
    const record = { hash: "current" } as SkillRecord;
    const legacy = { overall: 100 } as SkillEvalReport;
    expect(reportStatus(legacy, record)).toBe("unverified");
    const complete = { ...legacy, skillHash: "current", status: "complete" } as SkillEvalReport;
    expect(reportStatus(complete, record)).toBe("complete");
    expect(reportStatus({ ...complete, skillHash: "old" }, record)).toBe("stale");
    expect(reportStatus({ ...complete, status: "incomplete" }, record)).toBe("incomplete");
    expect(reportStatus(complete)).toBe("stale");
  });
});
