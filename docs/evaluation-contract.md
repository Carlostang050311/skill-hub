# skill-hub 评测契约

评测报告必须回答两个问题：这个结果评的是哪个 Skill 版本，以及这个分数能否被另一个人复现。模型返回内容本身不是完整证据。

## 输入契约

一次 `EvaluationRun` 至少绑定：

- `snapshotId` 和完整 Skill digest；
- `scenarioSetId`、每条 scenario 的原文和完整 digest；
- prompt 模板版本和完整 digest；
- rubric 版本和完整 digest；
- evaluator 版本；
- provider、model、temperature、seed、重复次数；
- 执行策略：网络、超时、内存、文件和进程限制；
- 运行时间、客户端版本和 Node 版本。

缺少任一绑定项时，结果只能标记为 `unverified`，不得进入当前质量榜。

## 作业类型

### Trigger

输入正例和反例，模型返回结构化布尔值。报告记录：

- 正例命中数；
- 反例误触发数；
- 总数、准确率、召回率和 false-positive rate；
- 每条作业的原始响应、解析错误和延迟。

### Clarity

清晰度可以继续使用 consistency、actionability、boundedness 三个维度，但 1–5 分必须绑定 rubric 版本，并支持人工校准和重复运行。模型自评只能作为一个 judge，不应被描述为客观真值。

### Exec

执行级结果必须同时满足：

1. 执行者报告可解析；
2. 评审者覆盖全部 rubric；
3. 真实产物检查全部通过；
4. 执行策略和信任等级允许运行；
5. 产物 digest 与执行 run 绑定。

任一条件失败，结果为 `incomplete` 或 `rejected`，不能仅靠评审者自报通过。

## 统计规则

- 单次得分之外记录重复运行的均值、标准差、样本数和置信区间。
- 缺失层不重新分配权重；现有 40% trigger / 30% clarity / 30% static 只能作为 `scorePolicyVersion=1` 保留。
- 评分策略变化必须生成新版本，历史报告按原策略解释。
- 公开榜单只接收完整绑定、非 stale、通过产物检查且 provider/model 元数据齐全的结果。
- 任何外部模型 API 失败、解析失败、超时、限流都必须单独计入失败率，不转换为 0 分后隐藏原因。

## 结果结构（概念）

```ts
interface EvaluationResultBinding {
  runId: string;
  snapshotDigest: string;
  scenarioDigest: string;
  promptDigest: string;
  rubricDigest: string;
  evaluatorVersion: string;
  provider: string;
  model: string;
  repetition: number;
  seed?: string;
}

interface EvaluationResult {
  binding: EvaluationResultBinding;
  status: "complete" | "incomplete" | "stale" | "rejected";
  metrics: Record<string, number | null>;
  errors: Array<{ code: string; message: string }>;
  evidenceIds: string[];
}
```

## 防污染规则

- Skill 正文、用户输入、执行产物和评审输出必须在提示词中有清晰边界，避免 prompt injection 混淆指令和数据。
- 评审者只能读取声明的证据摘要和真实检查结果，不能把执行者的自述当成事实。
- 评测输入集需要版本化；新增、删除或改写 scenario 都生成新 digest。
- 评测导出必须包含绑定元数据、失败原因和证据摘要，不能只导出一个总分。
