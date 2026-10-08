export interface Scenario {
  skill: string;
  shouldTrigger: string[];
  shouldNotTrigger: string[];
  notes?: string;
  /** 原始 YAML 映射（execute 块等扩展字段从这里读） */
  raw?: Record<string, unknown>;
}

export type JobType = "trigger" | "clarity";

export interface EvalJob {
  id: string;
  type: JobType;
  skill: string;
  /** 执行器把 messages 原样交给模型 */
  messages: Array<{ role: "user"; content: string }>;
  /** type=trigger 时的期望答案 */
  expectTrigger?: boolean;
  skillHash?: string;
  skillId?: string;
  skillPath?: string;
  /** 清晰度作业保存用例快照，以便用例消失后仍能报告原计划。 */
  scenario?: Scenario;
  scenarioHash?: string;
}

export interface JobResult {
  id: string;
  /** 模型原始输出 */
  raw: string;
  error?: string;
  latencyMs?: number;
  tokens?: number;
}

export interface SkillEvalReport {
  skill: string;
  skillPath: string;
  source: string;
  triggerScore: number | null;
  triggerCorrect: number;
  triggerTotal: number;
  /** 不该触发却被判触发的数量（过触发是最常见的问题） */
  falsePositives: number;
  clarityScore: number | null;
  consistency: number | null;
  actionability: number | null;
  boundedness: number | null;
  issues: string[];
  staticScore: number;
  warningCount: number;
  overall: number | null;
  /** 结果解析失败的作业数 */
  errors: number;
  skillHash?: string;
  skillId?: string;
  scenarioHash?: string;
  expectedJobs?: number;
  completedJobs?: number;
  completionRate?: number;
  status?: "complete" | "incomplete" | "stale";
}

export interface RunReport {
  startedAt: string;
  backend: string;
  model?: string;
  results: SkillEvalReport[];
  avgTrigger: number | null;
  avgClarity: number | null;
  avgStatic: number;
  avgOverall: number | null;
  expectedJobs?: number;
  completedJobs?: number;
  completionRate?: number;
  errors?: number;
}
