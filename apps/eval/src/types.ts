export interface Scenario {
  skill: string;
  shouldTrigger: string[];
  shouldNotTrigger: string[];
  notes?: string;
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
}

export interface JobResult {
  id: string;
  /** 模型原始输出 */
  raw: string;
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
}
