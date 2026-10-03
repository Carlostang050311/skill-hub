import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { cache } from "react";
import { latestRun, listRuns, openDb, type RunReport, type RunSummaryRow } from "@skillhub/eval";

export interface EvalData {
  runs: RunSummaryRow[];
  latest: { summary: RunSummaryRow; report: RunReport } | null;
}

/** 读取 ~/.skillhub/eval.db；文件不存在说明还没跑过评测 */
export const getEvalData = cache((): EvalData | null => {
  const dbPath = path.join(os.homedir(), ".skillhub", "eval.db");
  if (!fs.existsSync(dbPath)) return null;
  const db = openDb(dbPath);
  return { runs: listRuns(db), latest: latestRun(db) };
});
